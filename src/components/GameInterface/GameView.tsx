import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Save } from '@/types/save';
import type { Message, MessageSegment } from '@/types/message';
import { getActiveApi } from '@/types/config';
import { getMessagesBySaveId, createMessage, updateMessage, updateSave, deleteMessage, getMessagesByRoundRange } from '@/db/repository';
import { createNonStreamingRequest, createSystemPrompt } from '@/config/api';
import { parseMessageSegments } from '@/utils/parsers';
import { COMPRESSION_THRESHOLD, COMPRESSION_WINDOW_SIZE, CONTEXT_WINDOW_SIZE, MESSAGE_PAGE_SIZE, FONT_SIZE_CLASS_MAP, CONTINUE_STORY_PROMPT } from '@/config/constants';
import ParserWorker from '@/workers/parser.worker?worker';
import CompressWorker from '@/workers/compress.worker?worker';
import VirtualMessageList from '@/components/GameInterface/VirtualMessageList';
import InputArea from '@/components/GameInterface/InputArea';
import ContextMenu from '@/components/GameInterface/ContextMenu';
import MessageEditor from '@/components/GameInterface/MessageEditor';
import { startBackgroundAIRequest, hasPendingTask } from '@/services/backgroundAI';

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingBufferRef = useRef('');
  const streamingMessageIdRef = useRef<string | null>(null);
  const handleContinueStoryRef = useRef<() => Promise<void>>(async () => {});
  const handleSendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});
  const selectedApiOverrideRef = useRef<string | null>(null);
  const editingMessageRef = useRef<Message | null>(null);

  const INPUT_DRAFT_KEY = `ta_input_draft_${save.id}`;
  const [inputDraft, setInputDraft] = useState<string>(() => {
    try {
      return localStorage.getItem(INPUT_DRAFT_KEY) || '';
    } catch { return ''; }
  });

  const handleInputDraftChange = useCallback((text: string) => {
    setInputDraft(text);
    try { localStorage.setItem(INPUT_DRAFT_KEY, text); } catch {}
  }, [INPUT_DRAFT_KEY]);

  const parseWithFallback = useCallback(async (messageId: string, rawText: string): Promise<{ segments: MessageSegment[]; isValid: boolean }> => {
    try {
      const parserWorker = new ParserWorker();
      const result = await new Promise<{ segments: MessageSegment[]; isValid: boolean }>((resolve, reject) => {
        parserWorker.onmessage = (workerEvent: MessageEvent) => resolve(workerEvent.data);
        parserWorker.onerror = (err) => reject(err);
        parserWorker.postMessage({ id: messageId, rawText });
      });
      return result;
    } catch (workerError) {
      console.warn('[GameView] ParserWorker失败，回退到主线程解析:', workerError);
      return parseMessageSegments(rawText);
    }
  }, []);

  const getNetworkConfig = useCallback(() => {
    const config = save.metadata.configSnapshot;
    const network = config?.network;
    if (!network) {
      console.warn('[GameView] getNetworkConfig: configSnapshot.network 不存在', {
        saveId: save.id,
        hasConfigSnapshot: !!config,
        hasNetwork: !!network,
      });
      return { apiKey: '', apiEndpoint: '', modelName: '', temperature: 0.8, topP: 0.95 };
    }

    const lookupNetwork = selectedApiOverrideRef.current
      ? { ...network, selectedId: selectedApiOverrideRef.current }
      : network;

    const activeApi = getActiveApi(lookupNetwork);

    if (activeApi && activeApi.apiKey && activeApi.apiEndpoint) {
      return {
        apiKey: activeApi.apiKey || '',
        apiEndpoint: activeApi.apiEndpoint || '',
        modelName: activeApi.modelName || '',
        temperature: activeApi.temperature ?? 0.8,
        topP: activeApi.topP ?? 0.95,
      };
    }

    if (activeApi) {
      console.warn('[GameView] getNetworkConfig: activeApi 存在但字段为空', {
        hasApiKey: !!activeApi.apiKey,
        hasEndpoint: !!activeApi.apiEndpoint,
        modelName: activeApi.modelName,
        apisCount: network.apis?.length,
        selectedId: lookupNetwork.selectedId,
      });
    }

    // 尝试从 localStorage 备份恢复
    if (save.id) {
      try {
        const raw = localStorage.getItem(`save_backup_${save.id}`);
        if (raw) {
          const backup: Save = JSON.parse(raw);
          const backupNetwork = backup.metadata?.configSnapshot?.network;
          if (backupNetwork) {
            const backupApi = getActiveApi(backupNetwork);
            if (backupApi?.apiKey) {
              console.log('[GameView] 从 localStorage 备份恢复 API 配置');
              return {
                apiKey: backupApi.apiKey,
                apiEndpoint: backupApi.apiEndpoint || '',
                modelName: backupApi.modelName || '',
                temperature: backupApi.temperature ?? 0.8,
                topP: backupApi.topP ?? 0.95,
              };
            }
          }
        }
      } catch (e) {
        console.warn('[GameView] localStorage 备份读取失败:', e);
      }
    }

    // 兜底：遍历所有 apis，取第一个有 apiKey 的
    if (network.apis && network.apis.length > 0) {
      const firstValid = network.apis.find(a => a.apiKey);
      if (firstValid) {
        console.log('[GameView] 使用第一个有值的 API 配置:', firstValid.label);
        return {
          apiKey: firstValid.apiKey,
          apiEndpoint: firstValid.apiEndpoint || '',
          modelName: firstValid.modelName || '',
          temperature: firstValid.temperature ?? 0.8,
          topP: firstValid.topP ?? 0.95,
        };
      }
    }

    return { apiKey: '', apiEndpoint: '', modelName: '', temperature: 0.8, topP: 0.95 };
  }, [save]);

  const networkConfig = save.metadata.configSnapshot?.network;
  const apis = networkConfig?.apis || [];
  const selectedApiId = networkConfig?.selectedId || '';
  const [displayedApiId, setDisplayedApiId] = useState(selectedApiId);

  const handleSelectApi = useCallback(
    async (apiId: string) => {
      if (!networkConfig) return;
      setDisplayedApiId(apiId);
      selectedApiOverrideRef.current = apiId;
      const updatedNetwork = { ...networkConfig, selectedId: apiId };
      try {
        await updateSave(save.id, {
          metadata: {
            configSnapshot: {
              ...(save.metadata.configSnapshot || {} as any),
              network: updatedNetwork,
            },
          },
        });
      } catch (e) {
        console.warn('[GameView] 更新API选择失败:', e);
      }
    },
    [save.id, save.metadata.configSnapshot, networkConfig],
  );

  const loadInitialMessages = useCallback(async () => {
    setLoadingState('loading');
    try {
      const msgs = await getMessagesBySaveId(save.id, CONTEXT_WINDOW_SIZE * 2);
      setMessages(msgs);
      setHasMoreMessages(msgs.length >= CONTEXT_WINDOW_SIZE * 2);
      setCurrentRound(save.metadata.roundCount);

      if (hasPendingTask(save.id)) {
        setLoadingState('sending');
      } else {
        setLoadingState('idle');
      }
    } catch {
      setLoadingState('error');
    }
  }, [save.id, save.metadata.roundCount]);

  useEffect(() => {
    loadInitialMessages();
  }, [loadInitialMessages]);

  useEffect(() => {
    editingMessageRef.current = editingMessage;
  }, [editingMessage]);

  const handleLoadMore = useCallback(async (): Promise<boolean> => {
    if (messages.length === 0) return false;

    const oldestMessage = messages[0];
    if (!oldestMessage) return false;

    const allMessages = await getMessagesBySaveId(save.id);
    const oldestIndex = allMessages.findIndex((m) => m.id === oldestMessage.id);

    if (oldestIndex <= 0) {
      setHasMoreMessages(false);
      return false;
    }

    const start = Math.max(0, oldestIndex - MESSAGE_PAGE_SIZE);
    const older = allMessages.slice(start, oldestIndex);

    if (older.length === 0) {
      setHasMoreMessages(false);
      return false;
    }

    setMessages((prev) => [...older, ...prev]);
    setHasMoreMessages(start > 0);
    return true;
  }, [messages, save.id]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();

      if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) {
        setLoadingState('error');
        return;
      }
      if (loadingState === 'sending') return;

      try {
        const roundIndex = currentRound + 1;
        const chatMessages = buildChatContext(messages, { role: 'user', rawText: text } as Message, save);

        const { userMessage, aiMessage, completion } = startBackgroundAIRequest({
          saveId: save.id,
          roundIndex,
          userRawText: text,
          chatMessages,
          apiEndpoint,
          apiKey,
          modelName,
          temperature,
          topP,
        });

        setMessages((prev) => [...prev, userMessage, aiMessage]);
        setCurrentRound(roundIndex);
        setLoadingState('sending');
        streamingMessageIdRef.current = aiMessage.id;

        completion.then(async () => {
          const allMsgs = await getMessagesBySaveId(save.id);
          setMessages(allMsgs);
          setCurrentRound(roundIndex);
          setLoadingState('idle');
          checkAndTriggerCompression(roundIndex);
        }).catch(() => {
          setLoadingState('error');
        }).finally(() => {
          streamingMessageIdRef.current = null;
          streamingBufferRef.current = '';
          abortControllerRef.current = null;
        });
      } catch (err) {
        console.error('[GameView] handleSendMessage 异常:', err);
        setLoadingState('error');
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
      }
    },
    [currentRound, save, messages, loadingState, getNetworkConfig],
  );

  const isLastAiMessage = useMemo(() => {
    const aiMsgs = messages.filter((m) => m.role === 'ai');
    if (aiMsgs.length === 0) return false;
    return aiMsgs[aiMsgs.length - 1].id === contextMenuTarget?.id;
  }, [messages, contextMenuTarget]);

  const handleContextMenuAction = useCallback(
    async (action: string, message: Message) => {
      setContextMenuTarget(null);

      switch (action) {
        case 'copy': {
          try {
            const text = message.rawText;
            await navigator.clipboard.writeText(text);
          } catch {
            const textarea = document.createElement('textarea');
            textarea.value = message.rawText;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          }
          break;
        }

        case 'edit': {
          setEditingMessage(message);
          break;
        }

        case 'resend': {
          if (message.role !== 'user') break;

          const confirmed = window.confirm(
            '重新发送将删除此消息及之后的所有消息，并重新调用AI生成。确定要继续吗？'
          );
          if (!confirmed) break;

          const targetIndex = messages.findIndex((m) => m.id === message.id);
          if (targetIndex === -1) break;

          const messagesToRemove = messages.slice(targetIndex);
          for (const m of messagesToRemove) {
            try { await deleteMessage(m.id); } catch {}
          }

          const keptMessages = messages.slice(0, targetIndex);
          setMessages(keptMessages);
          setCurrentRound(message.roundIndex);
          setLoadingState('idle');

          setTimeout(() => {
            handleSendMessageRef.current(message.rawText);
          }, 100);
          break;
        }

        case 'delete': {
          const confirmed = window.confirm('确定要删除这条消息吗？');
          if (!confirmed) break;
          setMessages((prev) => prev.filter((m) => m.id !== message.id));
          await deleteMessage(message.id);
          break;
        }

        case 'regenerate': {
          if (message.role !== 'ai') break;

          const userMsg = messages.find(
            (m) => m.roundIndex === message.roundIndex && m.role === 'user',
          );

          const filteredMessages = messages.filter((m) => m.roundIndex < message.roundIndex);

          await deleteMessage(message.id);
          setMessages(filteredMessages);

          if (userMsg) {
            handleRegenerateWithUserMessage(filteredMessages, userMsg, save);
          } else {
            handleRegenerateContinue(filteredMessages, save);
          }
          break;
        }

        case 'rewrite_longer':
        case 'rewrite_shorter': {
          if (message.role !== 'ai') break;

          const isLonger = action === 'rewrite_longer';
          const instruction = isLonger ? '更详细描述' : '更简略描述';

          setLoadingState('sending');

          const rewriteMessage = await createMessage({
            saveId: save.id,
            roundIndex: message.roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming',
          });

          setMessages((prev) =>
            prev.map((m) =>
              m.id === message.id ? { ...rewriteMessage, id: message.id } : m,
            ),
          );

          const chatMessages = buildRewriteContext(messages, message, save, instruction);

          const network = getNetworkConfig();
          const { controller, response } = createNonStreamingRequest(
            network.apiEndpoint,
            network.apiKey,
            network.modelName,
            chatMessages,
          );
          abortControllerRef.current = controller;

          streamingMessageIdRef.current = message.id;
          streamingBufferRef.current = '';

          let fullText: string;
          try {
            fullText = await response;
          } catch (err: any) {
            if (err.name !== 'AbortError') {
              console.error('[GameView] 改写API请求失败:', err);
              setLoadingState('error');
            }
            return;
          } finally {
            streamingMessageIdRef.current = null;
            streamingBufferRef.current = '';
            abortControllerRef.current = null;
          }

          streamingBufferRef.current = fullText;
          const { segments, isValid } = await parseWithFallback(message.id, fullText);

          updateMessage(message.id, {
            rawText: fullText,
            segments: isValid ? segments : [],
            status: 'completed',
          });

          setMessages((prev) =>
            prev.map((m) =>
              m.id === message.id
                ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
                : m,
            ),
          );

          setLoadingState('idle');
          break;
        }
      }
    },
    [messages, save, handleSendMessage],
  );

  const handleRegenerateWithUserMessage = useCallback(
    async (filteredMessages: Message[], userMsg: Message, save: Save) => {
      const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();

      if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) {
        setLoadingState('error');
        console.warn('[GameView] 重新生成失败：API Key 或 Endpoint 为空');
        return;
      }
      if (loadingState === 'sending') return;

      console.log('[GameView] handleRegenerateWithUserMessage 开始重新生成');

      try {
        const roundIndex = userMsg.roundIndex;

        setMessages((prev) => [...prev, userMsg]);
        setCurrentRound(roundIndex);
        setLoadingState('sending');

        let aiMessage: Message;
        try {
          aiMessage = await createMessage({
            saveId: save.id,
            roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming',
          });
        } catch (dbError) {
          console.warn('[GameView] AI消息写入数据库失败，使用内存临时消息:', dbError);
          const now = Date.now();
          aiMessage = {
            id: `temp_ai_${now}`,
            saveId: save.id,
            roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming' as const,
            createdAt: now,
            updatedAt: now,
          };
        }

        setMessages((prev) => [...prev, aiMessage]);
        streamingMessageIdRef.current = aiMessage.id;
        streamingBufferRef.current = '';

        const chatMessages = buildChatContext(filteredMessages, userMsg, save);

        const { controller, response } = createNonStreamingRequest(
          apiEndpoint,
          apiKey,
          modelName,
          chatMessages,
          { temperature, topP },
        );

        abortControllerRef.current = controller;

        let fullText: string;
        try {
          fullText = await response;
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('[GameView] API请求失败:', err);
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

        streamingBufferRef.current = fullText;
        const { segments, isValid } = await parseWithFallback(aiMessage.id, fullText);

        try {
          await updateMessage(aiMessage.id, {
            rawText: fullText,
            segments: isValid ? segments : [],
            status: 'completed',
          });
        } catch (dbError) {
          console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessage.id
              ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
              : m,
          ),
        );

        try {
          await updateSave(save.id, {
            metadata: { roundCount: roundIndex, lastPlayedAt: Date.now() },
          });
        } catch (dbError) {
          console.warn('[GameView] 更新保存失败:', dbError);
        }

        setLoadingState('idle');
      } catch (err) {
        console.error('[GameView] handleRegenerateWithUserMessage 异常:', err);
        setLoadingState('error');
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
      }
    },
    [getNetworkConfig, loadingState],
  );

  const handleRegenerateContinue = useCallback(
    async (filteredMessages: Message[], save: Save) => {
      const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();

      if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) {
        setLoadingState('error');
        console.warn('[GameView] 重新生成失败：API Key 或 Endpoint 为空');
        return;
      }
      if (loadingState === 'sending') return;

      console.log('[GameView] handleRegenerateContinue 开始重新生成');

      try {
        const roundIndex = filteredMessages.length > 0 
          ? Math.max(...filteredMessages.map(m => m.roundIndex)) + 1 
          : 1;

        setLoadingState('sending');
        setCurrentRound(roundIndex);

        let aiMessage: Message;
        try {
          aiMessage = await createMessage({
            saveId: save.id,
            roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming',
          });
        } catch (dbError) {
          console.warn('[GameView] AI消息写入数据库失败，使用内存临时消息:', dbError);
          const now = Date.now();
          aiMessage = {
            id: `temp_ai_${now}`,
            saveId: save.id,
            roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming' as const,
            createdAt: now,
            updatedAt: now,
          };
        }

        setMessages((prev) => [...prev, aiMessage]);
        streamingMessageIdRef.current = aiMessage.id;
        streamingBufferRef.current = '';

        const chatMessages = buildContinueContext(filteredMessages, save);

        const { controller, response } = createNonStreamingRequest(
          apiEndpoint,
          apiKey,
          modelName,
          chatMessages,
          { temperature, topP },
        );

        abortControllerRef.current = controller;

        let fullText: string;
        try {
          fullText = await response;
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('[GameView] API请求失败:', err);
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

        streamingBufferRef.current = fullText;
        const { segments, isValid } = await parseWithFallback(aiMessage.id, fullText);

        try {
          await updateMessage(aiMessage.id, {
            rawText: fullText,
            segments: isValid ? segments : [],
            status: 'completed',
          });
        } catch (dbError) {
          console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessage.id
              ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
              : m,
          ),
        );

        try {
          await updateSave(save.id, {
            metadata: { roundCount: roundIndex, lastPlayedAt: Date.now() },
          });
        } catch (dbError) {
          console.warn('[GameView] 更新保存失败:', dbError);
        }

        setLoadingState('idle');
      } catch (err) {
        console.error('[GameView] handleRegenerateContinue 异常:', err);
        setLoadingState('error');
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
      }
    },
    [getNetworkConfig, loadingState],
  );

  const checkAndTriggerCompression = useCallback(
    async (roundIndex: number) => {
      if (roundIndex < COMPRESSION_THRESHOLD) return;
      if (save.lastCompressedRound >= roundIndex - COMPRESSION_WINDOW_SIZE) return;

      const targetRounds = await getMessagesByRoundRange(save.id, 0, COMPRESSION_WINDOW_SIZE);
      if (targetRounds.length === 0) return;

      const messagesText = targetRounds
        .map((m) => `[${m.role === 'user' ? '玩家' : 'AI'}]: ${m.rawText}`)
        .join('\n');

      try {
        const compressWorker = new CompressWorker();
        const compressionPrompt = await new Promise<string>((resolve, reject) => {
          compressWorker.onmessage = (e: MessageEvent) => resolve(e.data.prompt);
          compressWorker.onerror = (err) => reject(err);
          compressWorker.postMessage({
            id: save.id,
            previousSummary: save.currentSummary,
            messagesText,
          });
        });

        const network = getNetworkConfig();
        const response = await fetch(network.apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${network.apiKey}`,
          },
          body: JSON.stringify({
            model: network.modelName,
            messages: [{ role: 'user', content: compressionPrompt }],
            temperature: 0.5,
          }),
        });

        if (!response.ok) return;

        const data = await response.json();
        const newSummary = data.choices?.[0]?.message?.content?.trim();

        if (newSummary) {
          await updateSave(save.id, {
            currentSummary: newSummary,
            lastCompressedRound: COMPRESSION_WINDOW_SIZE,
          });

          const anchorMessage = targetRounds[targetRounds.length - 1];
          if (anchorMessage) {
            await updateMessage(anchorMessage.id, { isCompressedAnchor: true });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === anchorMessage.id ? { ...m, isCompressedAnchor: true } : m,
              ),
            );
          }
        }
      } catch {
        console.error('Compression failed');
      }
    },
    [save],
  );

  const handleContinueStory = useCallback(async () => {
    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();

    console.log('[GameView] handleContinueStory 网络配置:', {
      apiEndpoint: apiEndpoint?.substring(0, 40),
      apiKey: apiKey ? `***${apiKey.slice(-4)}` : '(空)',
      modelName,
    });

    if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) {
      setLoadingState('error');
      console.warn('[GameView] 继续失败：API Key 或 Endpoint 为空');
      return;
    }
    if (loadingState === 'sending') return;

    console.log('[GameView] handleContinueStory 开始执行');

    try {
      const roundIndex = currentRound + 1;
      setLoadingState('sending');

      // 创建 AI 消息 - 即使数据库失败也先用内存临时的
      let aiMessage: Message;
      try {
        aiMessage = await createMessage({
          saveId: save.id,
          roundIndex,
          role: 'ai',
          rawText: '',
          segments: [],
          status: 'streaming',
        });
      } catch (dbError) {
        console.warn('[GameView] AI消息写入数据库失败，使用内存临时消息:', dbError);
        const now = Date.now();
        aiMessage = {
          id: `temp_ai_${now}`,
          saveId: save.id,
          roundIndex,
          role: 'ai',
          rawText: '',
          segments: [],
          status: 'streaming' as const,
          createdAt: now,
          updatedAt: now,
        };
      }

      setMessages((prev) => [...prev, aiMessage]);
      setCurrentRound(roundIndex);
      streamingMessageIdRef.current = aiMessage.id;
      streamingBufferRef.current = '';

      const chatMessages = buildContinueContext(messages, save);

      const { controller, response } = createNonStreamingRequest(
        apiEndpoint,
        apiKey,
        modelName,
        chatMessages,
        { temperature, topP },
      );

      abortControllerRef.current = controller;

      let fullText: string;
      try {
        fullText = await response;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('[GameView] API请求失败:', err);
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

      streamingBufferRef.current = fullText;
      const { segments, isValid } = await parseWithFallback(aiMessage.id, fullText);

      try {
        await updateMessage(aiMessage.id, {
          rawText: fullText,
          segments: isValid ? segments : [],
          status: 'completed',
        });
      } catch (dbError) {
        console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessage.id
            ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
            : m,
        ),
      );

      try {
        await updateSave(save.id, {
          metadata: { roundCount: roundIndex, lastPlayedAt: Date.now() },
        });
      } catch (dbError) {
        console.warn('[GameView] 更新保存失败:', dbError);
      }

      setLoadingState('idle');
      checkAndTriggerCompression(roundIndex);
    } catch (err) {
      console.error('[GameView] handleContinueStory 异常:', err);
      setLoadingState('error');
      streamingMessageIdRef.current = null;
      streamingBufferRef.current = '';
    }
  }, [currentRound, save, messages, loadingState, getNetworkConfig]);

  const handleRegenerateAfterEdit = useCallback(
    async (editedText: string) => {
      const target = editingMessageRef.current;
      if (!target) return;

      const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
      if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) {
        setLoadingState('error');
        return;
      }
      if (loadingState === 'sending') return;

      const roundIndex = target.roundIndex;

      try {
        setLoadingState('sending');

        let aiMessage: Message;
        try {
          aiMessage = await createMessage({
            saveId: save.id,
            roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming',
          });
        } catch (dbError) {
          console.warn('[GameView] 编辑后AI消息写入DB失败，使用内存:', dbError);
          const now = Date.now();
          aiMessage = {
            id: `temp_edit_ai_${now}`,
            saveId: save.id,
            roundIndex,
            role: 'ai',
            rawText: '',
            segments: [],
            status: 'streaming' as const,
            createdAt: now,
            updatedAt: now,
          };
        }

        setMessages((prev) => [...prev, aiMessage]);
        streamingMessageIdRef.current = aiMessage.id;
        streamingBufferRef.current = '';

        // 使用编辑前该回合之前的所有消息构建上下文
        const contextMessages = messages.filter(
          (m) => m.roundIndex < roundIndex,
        );
        const chatMessages = buildChatContext(contextMessages, { ...target, rawText: editedText }, save);

        const { controller, response } = createNonStreamingRequest(
          apiEndpoint, apiKey, modelName, chatMessages, { temperature, topP },
        );
        abortControllerRef.current = controller;

        let fullText: string;
        try {
          fullText = await response;
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('[GameView] API请求失败:', err);
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

        streamingBufferRef.current = fullText;
        const { segments, isValid } = await parseWithFallback(aiMessage.id, fullText);

        try {
          await updateMessage(aiMessage.id, {
            rawText: fullText,
            segments: isValid ? segments : [],
            status: 'completed',
          });
        } catch (dbError) {
          console.warn('[GameView] 编辑后更新AI消息DB失败:', dbError);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessage.id
              ? { ...m, rawText: fullText, segments: isValid ? segments : [], status: 'completed' as const }
              : m,
          ),
        );
        try {
          await updateSave(save.id, { metadata: { roundCount: roundIndex, lastPlayedAt: Date.now() } });
        } catch (dbError) {
          console.warn('[GameView] 更新保存失败:', dbError);
        }

        setLoadingState('idle');
      } catch (err) {
        console.error('[GameView] handleRegenerateAfterEdit 异常:', err);
        setLoadingState('error');
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
      }
    },
    [save, messages, loadingState, getNetworkConfig],
  );

  const parseEditedTextToSegments = useCallback(
    (text: string, oldSegments: MessageSegment[]): MessageSegment[] => {
      const blocks = text.split(/\n\n+/).filter(b => b.trim());

      return blocks.map((block, idx) => {
        const trimmed = block.trim();
        const oldSeg = oldSegments[idx];

        const matchScene = trimmed.match(/^\[场景\]\s*(.+)/s);
        if (matchScene) {
          return { type: 'scene' as const, content: matchScene[1].trim() };
        }

        const matchSystem = trimmed.match(/^\[系统\]\s*(.+)/s);
        if (matchSystem) {
          return { type: 'system' as const, content: matchSystem[1].trim() };
        }

        const matchAction = trimmed.match(/^\*(.+)\*$/s);
        if (matchAction) {
          return { type: 'action' as const, content: matchAction[1].trim() };
        }

        const matchDialogue = trimmed.match(/^【(.+?)】\s*(.+)/s);
        if (matchDialogue) {
          return { type: 'dialogue' as const, speaker: matchDialogue[1], content: matchDialogue[2].trim() };
        }

        return oldSeg
          ? { ...oldSeg, content: trimmed }
          : { type: (oldSegments[0]?.type || 'scene') as MessageSegment['type'], content: trimmed };
      });
    },
    [],
  );

  const handleEditSave = useCallback(
    async (editedText: string) => {
      const target = editingMessageRef.current;
      if (!target) return;

      try {
        if (target.role === 'ai') {
          const oldSegments = target.segments || [];
          const updatedSegments = parseEditedTextToSegments(editedText, oldSegments);

          await updateMessage(target.id, {
            rawText: editedText,
            segments: updatedSegments,
          });

          setMessages((prev) =>
            prev.map((m) =>
              m.id === target.id
                ? { ...m, rawText: editedText, segments: updatedSegments }
                : m,
            ),
          );
        } else {
          await updateMessage(target.id, { rawText: editedText });

          setMessages((prev) =>
            prev.map((m) =>
              m.id === target.id ? { ...m, rawText: editedText } : m,
            ),
          );

          const aiMsg = messages.find(
            (m) => m.roundIndex === target.roundIndex && m.role === 'ai',
          );
          if (aiMsg) {
            await deleteMessage(aiMsg.id);
            setMessages((prev) => prev.filter((m) => m.id !== aiMsg.id));
          }
          setEditingMessage(null);
          editingMessageRef.current = null;

          handleRegenerateAfterEdit(editedText);
          return;
        }

        setEditingMessage(null);
        editingMessageRef.current = null;
      } catch (dbError) {
        console.error('[GameView] handleEditSave 保存失败:', dbError);
      }
    },
    [messages, handleRegenerateAfterEdit],
  );

  handleContinueStoryRef.current = handleContinueStory;
handleSendMessageRef.current = handleSendMessage;

  const isSending = loadingState === 'sending';

  const fontSizeClass = FONT_SIZE_CLASS_MAP[save.metadata.configSnapshot.system.fontSize] || 'text-base';

  if (loadingState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-secondary">加载对话记录...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-surface dark:bg-surface-dark">
      <header className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
        <button
          onClick={onBackToMenu}
          className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark min-h-[44px] min-w-[44px]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden tablet:inline">返回</span>
        </button>

        <div className="text-center">
          <h1 className="text-sm font-semibold truncate max-w-[200px]">
            {save.metadata.configSnapshot.character.name || '冒险'} - 第{currentRound}回合
          </h1>
        </div>

        <button
          onClick={onOpenMemory}
          className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark min-h-[44px] min-w-[44px]"
          title="记忆面板"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </button>
      </header>

      {loadingState === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-red-600 dark:text-red-400">
              AI响应出错，请检查API配置或重试
            </span>
            <button
              onClick={() => setLoadingState('idle')}
              className="text-xs text-red-500 underline"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {isSending && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-200 dark:border-indigo-800 px-4 py-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              AI 正在生成回复...
            </span>
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col min-h-0 ${fontSizeClass}`}>
        <VirtualMessageList
          messages={messages}
          onLoadMore={handleLoadMore}
          hasMore={hasMoreMessages}
          onMessageLongPress={(msg) => setContextMenuTarget(msg)}
        />

        <InputArea
          onSend={handleSendMessage}
          onContinue={handleContinueStory}
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
          isLastAiMessage={isLastAiMessage}
          onAction={(action) => handleContextMenuAction(action, contextMenuTarget)}
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
    </div>
  );
}

function buildChatContext(
  messages: Message[],
  userMessage: Message,
  save: Save,
): Array<{ role: string; content: string }> {
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

  const result: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (save.currentSummary) {
    result.push({
      role: 'system',
      content: `[历史摘要]\n${save.currentSummary}`,
    });
  }

  const recentMessages = messages.slice(-CONTEXT_WINDOW_SIZE * 2);
  for (const msg of recentMessages) {
    result.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.rawText,
    });
  }

  result.push({
    role: 'user',
    content: userMessage.rawText,
  });

  return result;
}

function buildContinueContext(
  messages: Message[],
  save: Save,
): Array<{ role: string; content: string }> {
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

  const result: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (save.currentSummary) {
    result.push({
      role: 'system',
      content: `[历史摘要]\n${save.currentSummary}`,
    });
  }

  const recentMessages = messages.slice(-CONTEXT_WINDOW_SIZE * 2);
  for (const msg of recentMessages) {
    result.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.rawText,
    });
  }

  result.push({
    role: 'user',
    content: CONTINUE_STORY_PROMPT,
  });

  return result;
}

function buildRewriteContext(
  messages: Message[],
  targetMessage: Message,
  _save: Save,
  instruction: string,
): Array<{ role: string; content: string }> {
  const previousMsgs = messages.filter(
    (m) => m.createdAt < targetMessage.createdAt && m.roundIndex === targetMessage.roundIndex,
  );

  const result: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content: `请根据以下上下文，用${instruction}的方式重新描述之前的AI回复。保持JSON数组格式不变。`,
    },
  ];

  for (const msg of previousMsgs) {
    result.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.rawText,
    });
  }

  result.push({
    role: 'assistant',
    content: targetMessage.rawText,
  });

  result.push({
    role: 'user',
    content: `请用${instruction}的方式重写上面的回复。`,
  });

  return result;
}
