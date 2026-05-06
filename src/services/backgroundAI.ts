import { createNonStreamingRequest } from '@/config/api';
import { createMessage, updateMessage, updateSave } from '@/db/repository';
import { putToStore } from '@/db/database';
import { parseMessageSegments } from '@/utils/parsers';
import ParserWorker from '@/workers/parser.worker?worker';
import type { Message, MessageSegment } from '@/types/message';
import { STORE_MESSAGES } from '@/config/constants';

interface PendingTask {
  saveId: string;
  aiMessageId: string;
  userMessageId: string;
  roundIndex: number;
  controller: AbortController;
  promise: Promise<void>;
}

const pendingTasks = new Map<string, PendingTask>();

const memoryMessageStore = new Map<string, Message>();

function storeMemoryMessage(message: Message): void {
  memoryMessageStore.set(message.id, message);
}

function getMemoryMessage(id: string): Message | undefined {
  return memoryMessageStore.get(id);
}

function removeMemoryMessage(id: string): void {
  memoryMessageStore.delete(id);
}

function parseWithWorkerFallback(messageId: string, rawText: string): Promise<{ segments: MessageSegment[]; isValid: boolean }> {
  return new Promise((resolve) => {
    try {
      const parserWorker = new ParserWorker();
      const timer = setTimeout(() => {
        parserWorker.terminate();
        resolve(parseMessageSegments(rawText));
      }, 5000);
      parserWorker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      parserWorker.onerror = () => {
        clearTimeout(timer);
        resolve(parseMessageSegments(rawText));
      };
      parserWorker.postMessage({ id: messageId, rawText });
    } catch {
      resolve(parseMessageSegments(rawText));
    }
  });
}

export function hasPendingTask(saveId: string): boolean {
  return pendingTasks.has(saveId);
}

export function abortPendingTask(saveId: string): void {
  const task = pendingTasks.get(saveId);
  if (task) {
    task.controller.abort();
    pendingTasks.delete(saveId);
  }
}

export function startBackgroundAIRequest(params: {
  saveId: string;
  roundIndex: number;
  userRawText: string;
  chatMessages: Array<{ role: string; content: string }>;
  apiEndpoint: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  topP: number;
}): { userMessage: Message; aiMessage: Message; completion: Promise<void> } {
  const { saveId, roundIndex, userRawText, chatMessages, apiEndpoint, apiKey, modelName, temperature, topP } = params;

  abortPendingTask(saveId);

  const now = Date.now();
  const batchId = `msg_${now}`;

  const userMessage: Message = {
    id: `${batchId}_0`,
    saveId,
    roundIndex,
    role: 'user',
    rawText: userRawText,
    segments: [],
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  };

  const aiMessage: Message = {
    id: `${batchId}_1`,
    saveId,
    roundIndex,
    role: 'ai',
    rawText: '',
    segments: [],
    status: 'streaming',
    createdAt: now,
    updatedAt: now,
  };

  storeMemoryMessage(userMessage);
  storeMemoryMessage(aiMessage);

  const controller = new AbortController();

  const completion = (async () => {
    try {
      await createMessage({
        saveId,
        roundIndex,
        role: 'user',
        rawText: userRawText,
        status: 'completed',
      });
    } catch (e) {
      console.warn('[BackgroundAI] 用户消息写入DB失败:', e);
    }

    let dbAiMessageId: string | null = null;
    try {
      const dbMsg = await createMessage({
        saveId,
        roundIndex,
        role: 'ai',
        rawText: '',
        segments: [],
        status: 'streaming',
      });
      dbAiMessageId = dbMsg.id;

      const memoryAi = getMemoryMessage(aiMessage.id);
      if (memoryAi) {
        storeMemoryMessage({ ...memoryAi, id: dbAiMessageId });
        removeMemoryMessage(aiMessage.id);
      }
    } catch (e) {
      console.warn('[BackgroundAI] AI消息写入DB失败:', e);
    }

    const { controller: fetchController, response } = createNonStreamingRequest(
      apiEndpoint,
      apiKey,
      modelName,
      chatMessages,
      { temperature, topP },
    );

    controller.signal.addEventListener('abort', () => fetchController.abort());

    let fullText: string;
    try {
      fullText = await response;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[BackgroundAI] API请求失败:', err);
        const targetId = dbAiMessageId || aiMessage.id;
        try { await updateMessage(targetId, { status: 'error' }); } catch {}
        const memoryAi = getMemoryMessage(targetId);
        if (memoryAi) {
          storeMemoryMessage({ ...memoryAi, status: 'error' });
        }
      }
      pendingTasks.delete(saveId);
      return;
    }

    const { segments, isValid } = await parseWithWorkerFallback(
      dbAiMessageId || aiMessage.id,
      fullText,
    );

    const targetId = dbAiMessageId || aiMessage.id;
    const completedMessage: Message = {
      id: targetId,
      saveId,
      roundIndex,
      role: 'ai',
      rawText: fullText,
      segments: isValid ? segments : [],
      status: 'completed',
      createdAt: now,
      updatedAt: Date.now(),
    };

    try {
      await updateMessage(targetId, {
        rawText: fullText,
        segments: isValid ? segments : [],
        status: 'completed',
      });
      removeMemoryMessage(targetId);
    } catch (e) {
      console.warn('[BackgroundAI] 更新AI消息DB失败，保留在内存中:', e);
      storeMemoryMessage(completedMessage);
    }

    try {
      await updateSave(saveId, {
        metadata: { roundCount: roundIndex, lastPlayedAt: Date.now() },
      });
    } catch (e) {
      console.warn('[BackgroundAI] 更新存档DB失败:', e);
    }

    pendingTasks.delete(saveId);
  })();

  pendingTasks.set(saveId, {
    saveId,
    aiMessageId: aiMessage.id,
    userMessageId: userMessage.id,
    roundIndex,
    controller,
    promise: completion,
  });

  return { userMessage, aiMessage, completion };
}

export function getMemoryMessagesForSave(saveId: string): Message[] {
  const result: Message[] = [];
  for (const msg of memoryMessageStore.values()) {
    if (msg.saveId === saveId) {
      result.push(msg);
    }
  }
  return result.sort((a, b) => a.roundIndex - b.roundIndex || a.createdAt - b.createdAt);
}

export async function flushMemoryMessagesToDB(saveId: string): Promise<number> {
  const messages = getMemoryMessagesForSave(saveId);
  let flushed = 0;

  for (const msg of messages) {
    try {
      await putToStore(STORE_MESSAGES, msg);
      removeMemoryMessage(msg.id);
      flushed++;
    } catch (e) {
      console.warn('[BackgroundAI] flush内存消息到DB失败:', msg.id, e);
    }
  }

  return flushed;
}
