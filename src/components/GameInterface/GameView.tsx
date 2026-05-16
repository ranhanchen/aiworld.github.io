import { useState, useEffect, useCallback, useRef } from 'react';
import type { Save } from '@/types/save';
import type { Message, MessageSegment } from '@/types/message';
import { getActiveApi } from '@/types/config';
import { getMessagesBySaveId, updateMessage, updateSave, deleteMessage, getMessagesByRoundRange } from '@/db/repository';
import { createNonStreamingRequest, createSystemPrompt } from '@/config/api';
import { parseMessageSegments } from '@/utils/parsers';
import { COMPRESSION_THRESHOLD, COMPRESSION_WINDOW_SIZE, CONTEXT_WINDOW_SIZE, MESSAGE_PAGE_SIZE, FONT_SIZE_CLASS_MAP, CONTINUE_STORY_PROMPT } from '@/config/constants';
import ParserWorker from '@/workers/parser.worker?worker';
import CompressWorker from '@/workers/compress.worker?worker';
import VirtualMessageList from '@/components/GameInterface/VirtualMessageList';
import InputArea from '@/components/GameInterface/InputArea';
import ContextMenu from '@/components/GameInterface/ContextMenu';
import MessageEditor from '@/components/GameInterface/MessageEditor';
import { startBackgroundAIRequest, hasPendingTask, getMemoryMessagesForSave, flushMemoryMessagesToDB } from '@/services/backgroundAI';
import ConfirmDialog from '@/components/Common/ConfirmDialog';

interface GameViewProps {
  save: Save;
  onOpenMemory: () => void;
  onBackToMenu: () => void;
}

type LoadingState = 'idle' | 'loading' | 'sending' | 'error';

export default function GameView({ save, onOpenMemory, onBackToMenu }: GameViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [currentRound, setCurrentRound] = useState(save.metadata.roundCount);
  const [contextMenuTarget, setContextMenuTarget] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [compressionNoticeDismissed, setCompressionNoticeDismissed] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingBufferRef = useRef('');
  const streamingMessageIdRef = useRef<string | null>(null);
  const handleContinueStoryRef = useRef<() => Promise<void>>(async () => {});
  const handleSendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});
  const selectedApiOverrideRef = useRef<string | null>(null);
  const editingMessageRef = useRef<Message | null>(null);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  /** 统一处理消息：去 ```json 包裹、修尾逗号、重解析 segments */
  function processMessage(msg: Message): Message {
    if (msg.role !== 'ai') return msg;
    const raw = (msg.rawText || '').trim();
    // 如果不是 JSON 格式，尝试从格式化文本重建 segments
    if (!/^\[\s*\{/.test(raw) && !raw.startsWith('{')) {
      if (!msg.segments || msg.segments.length === 0) {
        const segs = parseEditedTextToSegments(raw, []);
        console.log('[processMessage] 从格式化文本重建 segments:', segs.length);
        return { ...msg, segments: segs };
      }
      return msg;
    }
    // 去 ```json ``` 包裹
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    // 去尾逗号 + 转义控制字符
    const sanitized = cleaned.replace(/,(\s*[\]}])/g, '$1');
    // 重解析 segments
    const result = parseMessageSegments(sanitized);
    console.log('[processMessage] 解析结果:', { rawText: sanitized.slice(0, 200), segmentsLen: result.segments.length, isValid: result.isValid, error: result.error });
    if (result.segments.length > 0) {
      return { ...msg, rawText: sanitized, segments: result.segments };
    }
    // 解析失败：如果 msg 原本有 segments 就保留，否则显示原始文本
    console.warn('[processMessage] 解析失败，保留原始消息:', result.error);
    return msg;
  }

  const INPUT_DRAFT_KEY = `ta_input_draft_${save.id}`;
  const [inputDraft, setInputDraft] = useState<string>(() => {
    try { return localStorage.getItem(INPUT_DRAFT_KEY) || ''; } catch { return ''; }
  });

  const handleInputDraftChange = useCallback((text: string) => {
    setInputDraft(text);
    try { localStorage.setItem(INPUT_DRAFT_KEY, text); } catch {}
  }, [INPUT_DRAFT_KEY]);

  const parseWithFallback = useCallback(async (messageId: string, rawText: string): Promise<{ segments: MessageSegment[]; isValid: boolean }> => {
    return new Promise((resolve) => {
      try {
        const parserWorker = new ParserWorker();
        const timer = setTimeout(() => {
          parserWorker.terminate();
          resolve(parseMessageSegments(rawText));
        }, 5000);
        parserWorker.onmessage = (workerEvent: MessageEvent) => {
          clearTimeout(timer);
          parserWorker.terminate();
          resolve(workerEvent.data);
        };
        parserWorker.onerror = () => {
          clearTimeout(timer);
          parserWorker.terminate();
          resolve(parseMessageSegments(rawText));
        };
        parserWorker.postMessage({ id: messageId, rawText });
      } catch {
        resolve(parseMessageSegments(rawText));
      }
    });
  }, []);

  const getNetworkConfig = useCallback(() => {
    const cfg = saveRef.current.metadata.configSnapshot;
    const network = cfg?.network;
    if (!network) {
      return { apiKey: '', apiEndpoint: '', modelName: '', temperature: 0.8, topP: 0.95 };
    }

    const lookupNetwork = selectedApiOverrideRef.current
      ? { ...network, selectedId: selectedApiOverrideRef.current }
      : network;

    const activeApi = getActiveApi(lookupNetwork);
    if (activeApi && activeApi.apiKey && activeApi.apiEndpoint) {
      return {
        apiKey: activeApi.apiKey,
        apiEndpoint: activeApi.apiEndpoint,
        modelName: activeApi.modelName || '',
        temperature: activeApi.temperature ?? 0.8,
        topP: activeApi.topP ?? 0.95,
      };
    }

    if (activeApi) {
      console.warn('[GameView] getNetworkConfig: activeApi 存在但字段为空');
    }

    const snapshotSave = saveRef.current;
    if (snapshotSave.id) {
      try {
        const raw = localStorage.getItem(`save_backup_${snapshotSave.id}`);
        if (raw) {
          const backup: Save = JSON.parse(raw);
          const backupNetwork = backup.metadata?.configSnapshot?.network;
          if (backupNetwork) {
            const backupApi = getActiveApi(backupNetwork);
            if (backupApi?.apiKey) return { apiKey: backupApi.apiKey, apiEndpoint: backupApi.apiEndpoint || '', modelName: backupApi.modelName || '', temperature: backupApi.temperature ?? 0.8, topP: backupApi.topP ?? 0.95 };
          }
        }
      } catch {}
    }

    if (network.apis && network.apis.length > 0) {
      const firstValid = network.apis.find(a => a.apiKey);
      if (firstValid) return { apiKey: firstValid.apiKey, apiEndpoint: firstValid.apiEndpoint || '', modelName: firstValid.modelName || '', temperature: firstValid.temperature ?? 0.8, topP: firstValid.topP ?? 0.95 };
    }

    return { apiKey: '', apiEndpoint: '', modelName: '', temperature: 0.8, topP: 0.95 };
  }, [save]);

  const networkConfig = save.metadata.configSnapshot?.network;
  const apis = networkConfig?.apis || [];
  const selectedApiId = networkConfig?.selectedId || '';
  const [displayedApiId, setDisplayedApiId] = useState(selectedApiId);

  const handleSelectApi = useCallback(async (apiId: string) => {
    if (!networkConfig) return;
    setDisplayedApiId(apiId);
    selectedApiOverrideRef.current = apiId;
    const updatedNetwork = { ...networkConfig, selectedId: apiId };
    try {
      await updateSave(save.id, {
        metadata: { configSnapshot: { ...(save.metadata.configSnapshot || {} as any), network: updatedNetwork } },
      });
    } catch (e) { console.warn('[GameView] 更新API选择失败:', e); }
  }, [save.id, save.metadata.configSnapshot, networkConfig]);

  const loadInitialMessages = useCallback(async () => {
    setLoadingState('loading');
    try {
      const msgs = await getMessagesBySaveId(save.id, CONTEXT_WINDOW_SIZE * 2);
      const memoryMsgs = getMemoryMessagesForSave(save.id);
      console.log('[DB加载] 原始数据:', msgs.map(m => ({ id: m.id, role: m.role, rawText: m.rawText })));
      const merged = [...msgs];
      for (const mm of memoryMsgs) {
        const existingIdx = merged.findIndex((m) => m.id === mm.id);
        if (existingIdx >= 0) {
          merged[existingIdx] = mm;
        } else {
          merged.push(mm);
        }
      }
      merged.sort((a, b) => a.roundIndex - b.roundIndex || a.createdAt - b.createdAt);

      const orphans: Message[] = [];
      for (const msg of merged) {
        if (msg.role === 'ai' && msg.status === 'streaming' && (!msg.rawText || msg.rawText.trim() === '')) {
          msg.status = 'error';
          msg.rawText = '（AI回复生成中断 - 页面在生成过程中被关闭或刷新）';
          msg.updatedAt = Date.now();
          orphans.push(msg);
        }
      }
      if (orphans.length > 0) {
        console.warn('[GameView] 检测到孤魂消息（上轮生成中断）:', orphans.length);
        for (const orphan of orphans) {
          updateMessage(orphan.id, { status: 'error', rawText: orphan.rawText }).catch(() => {});
        }
      }

      setMessages(merged.map(processMessage));
      setHasMoreMessages(msgs.length >= CONTEXT_WINDOW_SIZE * 2);
      setCurrentRound(save.metadata.roundCount);
      if (hasPendingTask(save.id)) {
        setLoadingState('sending');
      } else {
        setLoadingState('idle');
        flushMemoryMessagesToDB(save.id).catch(() => {});
      }
    } catch (e) {
      const memoryMsgs = getMemoryMessagesForSave(save.id);
      if (memoryMsgs.length > 0) { setMessages(memoryMsgs); setCurrentRound(save.metadata.roundCount); setLoadingState('idle'); }
      else setLoadingState('error');
    }
  }, [save.id, save.metadata.roundCount]);

  useEffect(() => { loadInitialMessages(); }, [loadInitialMessages]);
  useEffect(() => { editingMessageRef.current = editingMessage; }, [editingMessage]);

  const handleLoadMore = useCallback(async (): Promise<boolean> => {
    if (messages.length === 0) return false;
    const oldestMessage = messages[0];
    if (!oldestMessage) return false;
    const allMessages = await getMessagesBySaveId(save.id);
    const oldestIndex = allMessages.findIndex((m) => m.id === oldestMessage.id);
    if (oldestIndex <= 0) { setHasMoreMessages(false); return false; }
    const start = Math.max(0, oldestIndex - MESSAGE_PAGE_SIZE);
    const older = allMessages.slice(start, oldestIndex);
    if (older.length === 0) { setHasMoreMessages(false); return false; }
    setMessages((prev) => [...older, ...prev]);
    setHasMoreMessages(start > 0);
    return true;
  }, [messages, save.id]);

  const handleSendMessage = useCallback(async (text: string) => {
    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
    if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) { setLoadingState('error'); return; }
    if (loadingState === 'sending') return;

    try {
      const roundIndex = currentRound + 1;
      const latestSave = saveRef.current;
      const chatMessages = buildChatContext(messages, { role: 'user', rawText: text } as Message, latestSave);

      const { userMessage, aiMessage, completion } = startBackgroundAIRequest({
        saveId: latestSave.id, roundIndex, userRawText: text, chatMessages, apiEndpoint, apiKey, modelName, temperature, topP,
      });

      setMessages((prev) => [...prev, userMessage, aiMessage]);
      setCurrentRound(roundIndex);
      setLoadingState('sending');
      streamingMessageIdRef.current = aiMessage.id;

      completion.then((result) => {
        if (result) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? processMessage({ ...m, rawText: result.rawText, status: 'completed' as const, updatedAt: Date.now() })
                : m,
            ),
          );
        }
        setCurrentRound(roundIndex);
        setLoadingState('idle');
        setCompressionNoticeDismissed(false);
        checkAndTriggerCompression(roundIndex);
      }).catch(() => setLoadingState('error')).finally(() => {
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
        abortControllerRef.current = null;
      });
    } catch (err) {
      console.error('[GameView] handleSendMessage 异常:', err);
      setLoadingState('error');
    }
  }, [currentRound, save, messages, loadingState, getNetworkConfig]);

  const handleRegenerateInPlace = useCallback(async (aiMessage: Message) => {
    const currentSave = saveRef.current;
    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
    if (!apiKey || !apiEndpoint) { setLoadingState('error'); return; }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === aiMessage.id
          ? { ...m, rawText: '', segments: [], status: 'streaming' as const }
          : m,
      ),
    );
    setLoadingState('sending');
    streamingMessageIdRef.current = aiMessage.id;
    streamingBufferRef.current = '';

    const precedingMessages = messages.filter(
      (m) => m.createdAt < aiMessage.createdAt || (m.createdAt <= aiMessage.createdAt && m.role === 'user' && m.roundIndex === aiMessage.roundIndex),
    );

    const systemPrompt = createSystemPrompt({
      world: currentSave.metadata.configSnapshot.world.world,
      map: currentSave.metadata.configSnapshot.world.map,
      keyCharacters: currentSave.metadata.configSnapshot.world.keyCharacters,
      aiTone: currentSave.metadata.configSnapshot.aiRestriction.aiTone,
      aiBasePrompt: currentSave.metadata.configSnapshot.aiRestriction.aiBasePrompt,
      characterName: currentSave.metadata.configSnapshot.character.name,
      characterGender: currentSave.metadata.configSnapshot.character.gender,
      characterAge: currentSave.metadata.configSnapshot.character.age,
      characterBackground: currentSave.metadata.configSnapshot.character.background,
      characterOccupation: currentSave.metadata.configSnapshot.character.occupation,
      characterSkills: currentSave.metadata.configSnapshot.character.skills,
      characterPersonality: currentSave.metadata.configSnapshot.character.personality,
      characterAppearance: currentSave.metadata.configSnapshot.character.appearance,
      mainGoal: currentSave.metadata.configSnapshot.winCondition.mainGoal,
      subGoals: currentSave.metadata.configSnapshot.winCondition.subGoals,
      failureConditions: currentSave.metadata.configSnapshot.winCondition.failureConditions,
      customFields: currentSave.metadata.configSnapshot.world.customFields,
    });

    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    if (currentSave.currentSummary) {
      chatMessages.push({ role: 'system', content: `[历史摘要]\n${currentSave.currentSummary}` });
    }
    const recent = precedingMessages.filter(m => m.roundIndex > currentSave.lastCompressedRound).slice(-CONTEXT_WINDOW_SIZE * 2);
    for (const msg of recent) {
      chatMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.rawText });
    }

    const { controller, response } = createNonStreamingRequest(apiEndpoint, apiKey, modelName, chatMessages, { temperature, topP });
    abortControllerRef.current = controller;

    let fullText: string;
    try {
      fullText = await response;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        try { await updateMessage(aiMessage.id, { status: 'error' }); } catch {}
        setMessages((prev) => prev.map((m) => m.id === aiMessage.id ? { ...m, status: 'error' as const } : m));
        setLoadingState('error');
      }
      return;
    } finally {
      streamingMessageIdRef.current = null;
      streamingBufferRef.current = '';
      abortControllerRef.current = null;
    }

    const { segments, isValid } = await parseWithFallback(aiMessage.id, fullText);
    try { await updateMessage(aiMessage.id, { rawText: fullText, segments: isValid ? segments : [], status: 'completed' }); } catch {}
    setMessages((prev) =>
      prev.map((m) =>
        m.id === aiMessage.id
          ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
          : m,
      ),
    );
    setLoadingState('idle');
  }, [messages, parseWithFallback, getNetworkConfig]);

  const handleRewriteInPlace = useCallback(async (aiMessage: Message, instruction: string) => {
    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
    if (!apiKey || !apiEndpoint) { setLoadingState('error'); return; }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === aiMessage.id
          ? { ...m, rawText: '', segments: [], status: 'streaming' as const }
          : m,
      ),
    );
    setLoadingState('sending');
    streamingMessageIdRef.current = aiMessage.id;
    streamingBufferRef.current = '';

    const previousMsgs = messages.filter(
      (m) => m.createdAt < aiMessage.createdAt && m.roundIndex === aiMessage.roundIndex,
    );
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: `请根据以下上下文，用${instruction}的方式重新描述之前的AI回复。保持JSON数组格式不变。` },
      ...previousMsgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.rawText })),
      ...(aiMessage.rawText ? [{ role: 'assistant' as const, content: aiMessage.rawText }] : []),
      ...(previousMsgs.filter(m => m.role === 'user').length > 0 ? [] : []),
      { role: 'user', content: `请用${instruction}的方式重写上面的回复。` },
    ];

    const { controller, response } = createNonStreamingRequest(apiEndpoint, apiKey, modelName, chatMessages, { temperature, topP });
    abortControllerRef.current = controller;

    let fullText: string;
    try {
      fullText = await response;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        try { await updateMessage(aiMessage.id, { status: 'error' }); } catch {}
        setMessages((prev) => prev.map((m) => m.id === aiMessage.id ? { ...m, status: 'error' as const } : m));
        setLoadingState('error');
      }
      return;
    } finally {
      streamingMessageIdRef.current = null;
      streamingBufferRef.current = '';
      abortControllerRef.current = null;
    }

    const { segments, isValid } = await parseWithFallback(aiMessage.id, fullText);
    try { await updateMessage(aiMessage.id, { rawText: fullText, segments: isValid ? segments : [], status: 'completed' }); } catch {}
    setMessages((prev) =>
      prev.map((m) =>
        m.id === aiMessage.id
          ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
          : m,
      ),
    );
    setLoadingState('idle');
  }, [messages, parseWithFallback, getNetworkConfig]);

  const handleContextMenuAction = useCallback(
    (action: string, message: Message) => {
      setContextMenuTarget(null);

      switch (action) {
        case 'copy': {
          try { navigator.clipboard.writeText(message.rawText); } catch {
            const textarea = document.createElement('textarea');
            textarea.value = message.rawText;
            textarea.style.position = 'fixed'; textarea.style.opacity = '0';
            document.body.appendChild(textarea); textarea.select();
            document.execCommand('copy'); document.body.removeChild(textarea);
          }
          break;
        }

        case 'edit': { setEditingMessage(message); break; }

        case 'resend': {
          if (message.role !== 'user') break;
          setConfirmDialog({
            message: '重新发送将删除此消息及之后的所有消息，并重新调用AI生成。确定要继续吗？',
            onConfirm: () => {
              setConfirmDialog(null);
              const targetIndex = messages.findIndex((m) => m.id === message.id);
              if (targetIndex === -1) return;
              const messagesToRemove = messages.slice(targetIndex);
              const keptMessages = messages.slice(0, targetIndex);
              for (const m of messagesToRemove) {
                deleteMessage(m.id).catch((e) => console.warn('[GameView] 重新发送：删除消息失败:', m.id, e));
              }
              setMessages(keptMessages);
              setCurrentRound(message.roundIndex);
              setLoadingState('idle');
              setTimeout(() => { handleSendMessageRef.current(message.rawText); }, 100);
            },
          });
          break;
        }

        case 'delete': {
          setConfirmDialog({
            message: '确定要删除这条消息吗？',
            onConfirm: async () => {
              setConfirmDialog(null);
              setMessages((prev) => prev.filter((m) => m.id !== message.id));
              await deleteMessage(message.id);
            },
          });
          break;
        }

        case 'regenerate': {
          if (message.role !== 'ai') break;
          setConfirmDialog({
            message: '重新生成将使用此消息之前的剧情上下文重新调用AI。当前消息内容将被替换，其他消息不受影响。确定要继续吗？',
            onConfirm: () => {
              setConfirmDialog(null);
              handleRegenerateInPlace(message);
            },
          });
          break;
        }

        case 'rewrite_longer':
        case 'rewrite_shorter': {
          if (message.role !== 'ai') break;
          const isLonger = action === 'rewrite_longer';
          const label = isLonger ? '更详细描述' : '更简略描述';
          setConfirmDialog({
            message: `将用"${label}"的方式重写此AI回复。当前消息内容将被替换。确定要继续吗？`,
            onConfirm: () => {
              setConfirmDialog(null);
              handleRewriteInPlace(message, label);
            },
          });
          break;
        }
      }
    },
    [messages, save, handleRegenerateInPlace, handleRewriteInPlace],
  );

  const handleContinueStory = useCallback(async () => {
    const latestSave = saveRef.current;
    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
    if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) { setLoadingState('error'); return; }
    if (loadingState === 'sending') return;

    try {
      const roundIndex = currentRound + 1;
      const chatMessages = buildContinueContext(messages, latestSave);

      const { userMessage, aiMessage, completion } = startBackgroundAIRequest({
        saveId: latestSave.id, roundIndex, userRawText: CONTINUE_STORY_PROMPT, chatMessages, apiEndpoint, apiKey, modelName, temperature, topP,
      });

      setMessages((prev) => [...prev, userMessage, aiMessage]);
      setCurrentRound(roundIndex);
      setLoadingState('sending');
      streamingMessageIdRef.current = aiMessage.id;

      completion.then((result) => {
        if (result) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? processMessage({ ...m, rawText: result.rawText, status: 'completed' as const, updatedAt: Date.now() })
                : m,
            ),
          );
        }
        setCurrentRound(roundIndex);
        setLoadingState('idle');
        setCompressionNoticeDismissed(false);
        checkAndTriggerCompression(roundIndex);
      }).catch(() => setLoadingState('error')).finally(() => {
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
        abortControllerRef.current = null;
      });
    } catch (err) { setLoadingState('error'); }
  }, [currentRound, save, messages, loadingState, getNetworkConfig]);

  useEffect(() => {
    handleContinueStoryRef.current = handleContinueStory;
    handleSendMessageRef.current = handleSendMessage;
  }, [handleContinueStory, handleSendMessage]);

  const checkAndTriggerCompression = useCallback(async (round: number) => {
    if (round < COMPRESSION_THRESHOLD) return;
    const latestSave = saveRef.current;
    try {
      const rangeMsgs = await getMessagesByRoundRange(latestSave.id, round - COMPRESSION_WINDOW_SIZE, round);
      if (rangeMsgs.length < COMPRESSION_WINDOW_SIZE) return;
      const compressWorker = new CompressWorker();
      const summary = await new Promise<string>((res, rej) => {
        compressWorker.onmessage = (e) => res(e.data);
        compressWorker.onerror = (err) => rej(err);
        compressWorker.postMessage({ previousSummary: latestSave.currentSummary, messages: rangeMsgs });
      });
      await updateSave(latestSave.id, { currentSummary: summary, lastCompressedRound: round });
    } catch (e) { console.warn('[GameView] 压缩失败:', e); }
  }, []);

  const handleRegenerateAfterEdit = useCallback(async (text: string) => {
    const latestSave = saveRef.current;
    const lastMsg = messages[messages.length - 1];
    const roundIndex = lastMsg ? lastMsg.roundIndex + 1 : 1;
    const chatMessages = buildChatContext(messages, { role: 'user', rawText: text } as Message, latestSave);

    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
    if (!apiKey || !apiEndpoint) { setLoadingState('error'); return; }

    const { aiMessage, completion } = startBackgroundAIRequest({
      saveId: latestSave.id, roundIndex, userRawText: text, chatMessages, apiEndpoint, apiKey, modelName, temperature, topP,
    });

    setMessages((prev) => [...prev, aiMessage]);
    setCurrentRound(roundIndex);
    setLoadingState('sending');

    completion.then((result) => {
      if (result) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessage.id
              ? { ...m, rawText: result.rawText, segments: result.segments, status: 'completed' as const, updatedAt: Date.now() }
              : m,
          ),
        );
      }
      setCurrentRound(roundIndex);
      setLoadingState('idle');
    }).catch(() => setLoadingState('error'));
  }, [messages, save, getNetworkConfig]);

  function parseEditedTextToSegments(editedText: string, originalSegments: MessageSegment[]): MessageSegment[] {
    if (!editedText.trim()) return originalSegments;
    const lines = editedText.split('\n').filter(l => l.trim());
    if (lines.length === 0) return originalSegments;

    const newSegments: MessageSegment[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i];
      let segment: MessageSegment | null = null;

      // 尝试从格式标记检测段类型
      if (/^\[场景\]/.test(trimmed)) {
        segment = { type: 'scene', content: trimmed.replace(/^\[场景\]\s*/, '') };
      } else if (/^\[系统\]/.test(trimmed)) {
        segment = { type: 'system', content: trimmed.replace(/^\[系统\]\s*/, '') };
      } else if (/^【[^】]+】/.test(trimmed)) {
        const match = trimmed.match(/^【([^】]+)】\s*(.*)/);
        segment = {
          type: 'dialogue',
          speaker: match?.[1] || '未知',
          content: match?.[2] || '',
        };
      } else if (/^\*.*\*$/.test(trimmed)) {
        segment = { type: 'action', content: trimmed.replace(/^\*/, '').replace(/\*$/, '') };
      } else {
        // 无标记：继承同位置原类型，超出部分默认为 scene
        if (i < originalSegments.length) {
          segment = { ...originalSegments[i], content: trimmed };
        } else {
          segment = { type: 'scene', content: trimmed };
        }
      }

      if (segment) {
        if (segment.type === 'dialogue' && !segment.speaker) {
          segment.speaker = '未知';
        }
        newSegments.push(segment);
      }
    }

    return newSegments;
  }

  const handleEditSave = useCallback(async (editedText: string) => {
    const target = editingMessageRef.current;
    if (!target) return;
    const updatedAt = Date.now();

    try {
      if (target.role === 'ai') {
        const oldSegments = target.segments || [];
        const updatedSegments = parseEditedTextToSegments(editedText, oldSegments);
        const updatedMsg = { ...target, rawText: editedText, segments: updatedSegments, updatedAt };
        setMessages((prev) => prev.map((m) => m.id === target.id ? updatedMsg : m));
        updateMessage(target.id, { rawText: editedText, segments: updatedSegments }).catch((e) => console.error('[GameView] AI消息编辑保存DB失败:', e));
      } else {
        const updatedMsg = { ...target, rawText: editedText, updatedAt };
        setMessages((prev) => prev.map((m) => m.id === target.id ? updatedMsg : m));
        updateMessage(target.id, { rawText: editedText }).catch((e) => console.error('[GameView] 用户消息编辑保存DB失败:', e));

        const aiMsg = messages.find((m) => m.roundIndex === target.roundIndex && m.role === 'ai');
        if (aiMsg) {
          setMessages((prev) => prev.filter((m) => m.id !== aiMsg.id));
          deleteMessage(aiMsg.id).catch((e) => console.warn('[GameView] 删除旧AI消息失败:', e));
        }
        setEditingMessage(null);
        editingMessageRef.current = null;
        handleRegenerateAfterEdit(editedText);
        return;
      }
      setEditingMessage(null);
      editingMessageRef.current = null;
    } catch (dbError) {
      console.error('[GameView] handleEditSave 异常:', dbError);
      setEditingMessage(null);
      editingMessageRef.current = null;
    }
  }, [messages, handleRegenerateAfterEdit]);

  const isSending = loadingState === 'sending';
  const fontSizeClass = FONT_SIZE_CLASS_MAP[save.metadata.configSnapshot?.system?.fontSize || 'medium'] || 'text-base';
  const roundsSinceCompression = currentRound - Math.max(save.lastCompressedRound || 0, 0);
  const shouldShowCompressionNotice = !compressionNoticeDismissed && roundsSinceCompression >= 10 && roundsSinceCompression % 5 === 0;
  const [elapsed, setElapsed] = useState(0);
  const sendStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (isSending) {
      sendStartRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - sendStartRef.current) / 1000));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isSending]);

  function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s}秒`;
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-surface dark:bg-surface-dark">
      <header className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
        <button
          onClick={() => { flushMemoryMessagesToDB(save.id).catch(() => {}); onBackToMenu(); }}
          className="flex items-center gap-1 text-lg text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark min-h-[44px] min-w-[44px]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          <span className="hidden tablet:inline">返回</span>
        </button>
        <div className="text-center">
          <h1 className="text-lg font-semibold">{save.metadata.title || '未命名'}</h1>
          <p className="text-base text-text-secondary dark:text-text-secondary-dark">第 {currentRound} 回合</p>
        </div>
        <button
          onClick={onOpenMemory}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-h-[44px] min-w-[44px]"
          title="记忆管理"
        >
          <svg className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M9 3v4m6-4v4" /></svg>
        </button>
      </header>

      {shouldShowCompressionNotice && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-base text-amber-700 dark:text-amber-300">
                已运行 {roundsSinceCompression} 回合未压缩记忆，建议压缩以保持AI上下文质量
              </span>
            </div>
            <div className="flex gap-2 shrink-0 ml-4">
              <button
                onClick={() => { setCompressionNoticeDismissed(true); onOpenMemory(); }}
                className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors min-h-[44px]"
              >
                前往压缩
              </button>
              <button
                onClick={() => setCompressionNoticeDismissed(true)}
                className="px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 min-h-[44px]"
              >
                稍后
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingState === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2">
          <div className="flex items-center justify-between">
            <span className="text-lg text-red-600 dark:text-red-400">AI响应出错，请检查API配置或重试</span>
            <button onClick={() => setLoadingState('idle')} className="text-base text-red-500 underline">关闭</button>
          </div>
        </div>
      )}

      {isSending && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-200 dark:border-indigo-800 px-4 py-1.5 flex items-center gap-2">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-base text-indigo-600 dark:text-indigo-400 font-medium">AI 正在生成回复... ({formatElapsed(elapsed)})</span>
        </div>
      )}

      <div className={`flex-1 flex flex-col min-h-0 ${fontSizeClass}`}>
        <VirtualMessageList messages={messages} onLoadMore={handleLoadMore} hasMore={hasMoreMessages} onMessageLongPress={(msg) => setContextMenuTarget(msg)} />
        <InputArea
          onSend={handleSendMessage}
          onContinue={() => handleContinueStoryRef.current()}
          disabled={isSending}
          apis={apis}
          selectedApiId={displayedApiId}
          onSelectApi={handleSelectApi}
          savedText={inputDraft}
          onTextChange={handleInputDraftChange}
        />
      </div>

      {contextMenuTarget && (
        <ContextMenu
          message={contextMenuTarget}
          onAction={(action) => handleContextMenuAction(action, contextMenuTarget!)}
          onClose={() => setContextMenuTarget(null)}
        />
      )}

      {editingMessage && (
        <MessageEditor
          message={editingMessage}
          onSave={handleEditSave}
          onCancel={() => setEditingMessage(null)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

function buildChatContext(messages: Message[], userMessage: Message, save: Save): Array<{ role: string; content: string }> {
  const systemPrompt = createSystemPrompt({
    world: save.metadata.configSnapshot.world.world,
    map: save.metadata.configSnapshot.world.map,
    keyCharacters: save.metadata.configSnapshot.world.keyCharacters,
    aiTone: save.metadata.configSnapshot.aiRestriction.aiTone,
    aiBasePrompt: save.metadata.configSnapshot.aiRestriction.aiBasePrompt,
    characterName: save.metadata.configSnapshot.character.name,
    characterGender: save.metadata.configSnapshot.character.gender,
    characterAge: save.metadata.configSnapshot.character.age,
    characterBackground: save.metadata.configSnapshot.character.background,
    characterOccupation: save.metadata.configSnapshot.character.occupation,
    characterSkills: save.metadata.configSnapshot.character.skills,
    characterPersonality: save.metadata.configSnapshot.character.personality,
    characterAppearance: save.metadata.configSnapshot.character.appearance,
    mainGoal: save.metadata.configSnapshot.winCondition.mainGoal,
    subGoals: save.metadata.configSnapshot.winCondition.subGoals,
    failureConditions: save.metadata.configSnapshot.winCondition.failureConditions,
    customFields: save.metadata.configSnapshot.world.customFields,
  });

  const result: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];
  if (save.currentSummary) result.push({ role: 'system', content: `[历史摘要]\n${save.currentSummary}` });
  const recentMessages = messages.filter(m => m.roundIndex > save.lastCompressedRound).slice(-CONTEXT_WINDOW_SIZE * 2);
  for (const msg of recentMessages) result.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.rawText });
  result.push({ role: 'user', content: userMessage.rawText });
  return result;
}

function buildContinueContext(messages: Message[], save: Save): Array<{ role: string; content: string }> {
  const systemPrompt = createSystemPrompt({
    world: save.metadata.configSnapshot.world.world,
    map: save.metadata.configSnapshot.world.map,
    keyCharacters: save.metadata.configSnapshot.world.keyCharacters,
    aiTone: save.metadata.configSnapshot.aiRestriction.aiTone,
    aiBasePrompt: save.metadata.configSnapshot.aiRestriction.aiBasePrompt,
    characterName: save.metadata.configSnapshot.character.name,
    characterGender: save.metadata.configSnapshot.character.gender,
    characterAge: save.metadata.configSnapshot.character.age,
    characterBackground: save.metadata.configSnapshot.character.background,
    characterOccupation: save.metadata.configSnapshot.character.occupation,
    characterSkills: save.metadata.configSnapshot.character.skills,
    characterPersonality: save.metadata.configSnapshot.character.personality,
    characterAppearance: save.metadata.configSnapshot.character.appearance,
    mainGoal: save.metadata.configSnapshot.winCondition.mainGoal,
    subGoals: save.metadata.configSnapshot.winCondition.subGoals,
    failureConditions: save.metadata.configSnapshot.winCondition.failureConditions,
    customFields: save.metadata.configSnapshot.world.customFields,
  });

  const result: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];
  if (save.currentSummary) result.push({ role: 'system', content: `[历史摘要]\n${save.currentSummary}` });
  const recentMessages = messages.filter(m => m.roundIndex > save.lastCompressedRound).slice(-CONTEXT_WINDOW_SIZE * 2);
  for (const msg of recentMessages) result.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.rawText });
  result.push({ role: 'user', content: CONTINUE_STORY_PROMPT });
  return result;
}
