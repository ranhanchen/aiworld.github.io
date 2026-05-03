import { createNonStreamingRequest } from '@/config/api';
import { createMessage, updateMessage, updateSave } from '@/db/repository';
import { parseMessageSegments } from '@/utils/parsers';
import ParserWorker from '@/workers/parser.worker?worker';
import type { Message, MessageSegment } from '@/types/message';

interface PendingTask {
  saveId: string;
  aiMessageId: string;
  userMessageId: string;
  roundIndex: number;
  controller: AbortController;
  promise: Promise<void>;
}

const pendingTasks = new Map<string, PendingTask>();

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

  const userMessage: Message = {
    id: `msg_u_${now}`,
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
    id: `msg_a_${now}`,
    saveId,
    roundIndex,
    role: 'ai',
    rawText: '',
    segments: [],
    status: 'streaming',
    createdAt: now,
    updatedAt: now,
  };

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

    try {
      await createMessage({
        saveId,
        roundIndex,
        role: 'ai',
        rawText: '',
        segments: [],
        status: 'streaming',
      });
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
        try { await updateMessage(aiMessage.id, { status: 'error' }); } catch {}
      }
      pendingTasks.delete(saveId);
      return;
    }

    const { segments, isValid } = await parseWithWorkerFallback(aiMessage.id, fullText);

    try {
      await updateMessage(aiMessage.id, {
        rawText: fullText,
        segments: isValid ? segments : [],
        status: 'completed',
      });
    } catch (e) {
      console.warn('[BackgroundAI] 更新AI消息DB失败:', e);
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
