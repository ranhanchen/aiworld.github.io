import { useState, useEffect, useCallback, useRef } from 'react';
import type { Save } from '@/types/save';
import type { Message } from '@/types/message';
import { getMessagesBySaveId, createMessage, updateMessage, updateSave, deleteMessage, getMessagesByRoundRange } from '@/db/repository';
import { createSSEConnection, createSystemPrompt } from '@/config/api';
import { parseMessageSegments } from '@/utils/parsers';
import { COMPRESSION_THRESHOLD, COMPRESSION_WINDOW_SIZE, CONTEXT_WINDOW_SIZE, MESSAGE_PAGE_SIZE, FONT_SIZE_CLASS_MAP, CONTINUE_STORY_PROMPT } from '@/config/constants';
import ParserWorker from '@/workers/parser.worker?worker';
import CompressWorker from '@/workers/compress.worker?worker';
import VirtualMessageList from '@/components/GameInterface/VirtualMessageList';
import InputArea from '@/components/GameInterface/InputArea';
import ContextMenu from '@/components/GameInterface/ContextMenu';
import MessageEditor from '@/components/GameInterface/MessageEditor';

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

  const getNetworkConfig = useCallback(() => {
    const config = save.metadata.configSnapshot;
    const network = config?.network;
    const apiKey = network?.apiKey || '';
    const apiEndpoint = network?.apiEndpoint || '';

    // If config from DB is missing key/endpoint, try localStorage backup
    if ((!apiKey || !apiEndpoint) && save.id) {
      try {
        const raw = localStorage.getItem(`save_backup_${save.id}`);
        if (raw) {
          const backup: Save = JSON.parse(raw);
          const backupNetwork = backup.metadata?.configSnapshot?.network;
          if (backupNetwork?.apiKey && backupNetwork?.apiEndpoint) {
            console.log('[GameView] 从 localStorage 备份中恢复网络配置');
            return { apiKey: backupNetwork.apiKey, apiEndpoint: backupNetwork.apiEndpoint, modelName: backupNetwork.modelName || '', temperature: backupNetwork.temperature ?? 0.8, topP: backupNetwork.topP ?? 0.95 };
          }
        }
      } catch (e) {
        console.warn('[GameView] localStorage 备份读取失败:', e);
      }
    }

    return { apiKey, apiEndpoint, modelName: network?.modelName || '', temperature: network?.temperature ?? 0.8, topP: network?.topP ?? 0.95 };
  }, [save]);

  const loadInitialMessages = useCallback(async () => {
    setLoadingState('loading');
    try {
      const msgs = await getMessagesBySaveId(save.id, CONTEXT_WINDOW_SIZE * 2);
      console.log('[GameView] loadInitialMessages 加载消息:', {
        saveId: save.id,
        roundCount: save.metadata.roundCount,
        CONTEXT_WINDOW_SIZE,
        limit: CONTEXT_WINDOW_SIZE * 2,
        消息数量: msgs.length,
        消息详情: msgs.map(m => ({ id: m.id, role: m.role, roundIndex: m.roundIndex, rawText: m.rawText.substring(0, 30) })),
      });
      setMessages(msgs);
      setHasMoreMessages(msgs.length >= CONTEXT_WINDOW_SIZE * 2);
      setCurrentRound(save.metadata.roundCount);
      setLoadingState('idle');
    } catch {
      setLoadingState('error');
    }
  }, [save.id, save.metadata.roundCount]);

  useEffect(() => {
    loadInitialMessages();
  }, [loadInitialMessages]);

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

      console.log('[GameView] handleSendMessage 网络配置:', {
        apiEndpoint: apiEndpoint?.substring(0, 40),
        apiKey: apiKey ? `***${apiKey.slice(-4)}` : '(空)',
        modelName,
      });

      if (!apiKey || !apiKey.trim() || !apiEndpoint || !apiEndpoint.trim()) {
        setLoadingState('error');
        console.warn('[GameView] 发送失败：API Key 或 Endpoint 为空');
        return;
      }
      if (loadingState === 'sending') return;

      console.log('[GameView] handleSendMessage 开始发送，文本:', text.substring(0, 50), {
        currentRound,
        newRoundIndex: currentRound + 1,
        saveId: save.id,
      });

      try {
        const roundIndex = currentRound + 1;
        
        // 创建用户消息 - 即使数据库写入失败，也先显示在内存中
        let userMessage: Message;
        try {
          userMessage = await createMessage({
            saveId: save.id,
            roundIndex,
            role: 'user',
            rawText: text,
            status: 'completed',
          });
        } catch (dbError) {
          console.warn('[GameView] 用户消息写入数据库失败，使用内存临时消息:', dbError);
          // 生成一个临时消息对象用于内存显示
          const now = Date.now();
          userMessage = {
            id: `temp_user_${now}`,
            saveId: save.id,
            roundIndex,
            role: 'user',
            rawText: text,
            segments: [],
            status: 'completed' as const,
            createdAt: now,
            updatedAt: now,
          };
        }

        setMessages((prev) => [...prev, userMessage]);
        setCurrentRound(roundIndex);
        setLoadingState('sending');

        // 创建 AI 消息
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
          console.log('[GameView] AI消息创建成功:', {
            aiMessageId: aiMessage.id,
            saveId: aiMessage.saveId,
            roundIndex: aiMessage.roundIndex,
          });
        } catch (dbError) {
          console.warn('[GameView] AI消息写入数据库失败，使用内存临时消息:', dbError);
          // 生成一个临时消息对象用于内存显示
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

        const chatMessages = buildChatContext(messages, userMessage, save);

        const controller = createSSEConnection(
          apiEndpoint,
          apiKey,
          modelName,
          chatMessages,
          { temperature, topP },
        );

        abortControllerRef.current = controller;

        const handleToken = (e: Event) => {
          const content = (e as CustomEvent<{ content: string }>).detail.content;
          streamingBufferRef.current += content;

          const result = parseMessageSegments(streamingBufferRef.current);
          if (result.isValid && result.segments.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? { ...m, segments: result.segments, rawText: streamingBufferRef.current }
                  : m,
              ),
            );
          }
        };

        const handleComplete = async () => {
          cleanup();
          const finalBuffer = streamingBufferRef.current;

          try {
            const parserWorker = new ParserWorker();
            const { segments, isValid } = await new Promise<{ segments: any[], isValid: boolean }>((resolve, reject) => {
              parserWorker.onmessage = (workerEvent: MessageEvent) => resolve(workerEvent.data);
              parserWorker.onerror = (err) => reject(err);
              parserWorker.postMessage({ id: aiMessage.id, rawText: finalBuffer });
            });

            // 尝试更新数据库中的消息
            try {
              await updateMessage(aiMessage.id, {
                rawText: finalBuffer,
                segments: isValid ? segments : [],
                status: 'completed',
              });
            } catch (dbError) {
              console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
            }

            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? {
                      ...m,
                      rawText: finalBuffer,
                      segments: isValid ? segments : [],
                      status: 'completed' as const,
                    }
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
          } catch (parseError) {
            console.error('Parser worker error:', parseError);
            // 即使解析失败也完成显示
            try {
              await updateMessage(aiMessage.id, { status: 'completed', rawText: finalBuffer, segments: [] });
            } catch {}
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? { ...m, status: 'completed' as const, rawText: finalBuffer, segments: [] }
                  : m,
              ),
            );
          }

          streamingMessageIdRef.current = null;
          streamingBufferRef.current = '';
          setLoadingState('idle');

          checkAndTriggerCompression(roundIndex);
        };

        const handleError = (e: Event) => {
          cleanup();
          const detail = (e as CustomEvent<{ status: number; message: string }>).detail;

          try {
            updateMessage(aiMessage.id, { status: 'error' });
          } catch {}

          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id ? { ...m, status: 'error' as const } : m,
            ),
          );

          console.error('SSE Error:', detail);
          streamingMessageIdRef.current = null;
          streamingBufferRef.current = '';
          setLoadingState('error');
        };

        const cleanup = () => {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          window.removeEventListener('sse-token', handleToken);
          window.removeEventListener('sse-complete', handleComplete);
          window.removeEventListener('sse-error', handleError);
        };

        window.addEventListener('sse-token', handleToken);
        window.addEventListener('sse-complete', handleComplete);
        window.addEventListener('sse-error', handleError);
      } catch (err) {
        console.error('[GameView] handleSendMessage 异常:', err);
        // 只在真正的 API 错误时显示错误提示
        if (String(err).includes('SSE') || String(err).includes('fetch')) {
          setLoadingState('error');
        }
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
      }
    },
    [currentRound, save, messages, loadingState, getNetworkConfig],
  );

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

        case 'delete': {
          setMessages((prev) => prev.filter((m) => m.id !== message.id));
          await deleteMessage(message.id);
          break;
        }

        case 'regenerate': {
          if (message.role !== 'ai') break;

          const userMsg = messages.find(
            (m) => m.roundIndex === message.roundIndex && m.role === 'user',
          );

          console.log('[GameView] 重新生成：查找用户消息', {
            aiMessageRoundIndex: message.roundIndex,
            foundUserMsg: !!userMsg,
          });

          // 过滤掉当前消息及后续消息
          const filteredMessages = messages.filter((m) => m.roundIndex < message.roundIndex);

          await deleteMessage(message.id);
          setMessages(filteredMessages);

          if (userMsg) {
            // 有用户消息，使用过滤后的消息列表和用户消息重新生成
            console.log('[GameView] 重新生成：找到用户消息', { userMsgId: userMsg.id, rawText: userMsg.rawText.substring(0, 50) });
            handleRegenerateWithUserMessage(filteredMessages, userMsg, save);
          } else {
            // 没有用户消息，这是继续按钮生成的消息，使用过滤后的消息列表重新生成
            console.log('[GameView] 重新生成：没有用户消息，使用继续上下文');
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

          const controller = createSSEConnection(
            save.metadata.configSnapshot.network.apiEndpoint,
            save.metadata.configSnapshot.network.apiKey,
            save.metadata.configSnapshot.network.modelName,
            chatMessages,
          );
          abortControllerRef.current = controller;

          streamingMessageIdRef.current = message.id;
          streamingBufferRef.current = '';

          let rewriteCleanup: (() => void) | null = null;

          rewriteCleanup = () => {
            window.removeEventListener('sse-token', rewriteHandleToken);
            window.removeEventListener('sse-complete', rewriteHandleComplete);
            window.removeEventListener('sse-error', rewriteHandleError);
          };

          const rewriteHandleToken = (e: Event) => {
            const content = (e as CustomEvent<{ content: string }>).detail.content;
            streamingBufferRef.current += content;
          };

          const rewriteHandleComplete = () => {
            rewriteCleanup?.();
            const finalBuffer = streamingBufferRef.current;

            const rewriteParserWorker = new ParserWorker();
            rewriteParserWorker.onmessage = (workerEvent: MessageEvent) => {
              const { segments, isValid } = workerEvent.data;

              updateMessage(message.id, {
                rawText: finalBuffer,
                segments: isValid ? segments : [],
                status: 'completed',
              });

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === message.id
                    ? {
                        ...m,
                        rawText: finalBuffer,
                        segments: isValid ? segments : [],
                        status: 'completed' as const,
                      }
                    : m,
                ),
              );

              streamingMessageIdRef.current = null;
              streamingBufferRef.current = '';
              setLoadingState('idle');
              abortControllerRef.current = null;
            };

            rewriteParserWorker.onerror = (err) => {
              console.error('Rewrite parser worker error:', err);
              streamingMessageIdRef.current = null;
              streamingBufferRef.current = '';
              setLoadingState('idle');
              abortControllerRef.current = null;
            };

            rewriteParserWorker.postMessage({ id: message.id, rawText: finalBuffer });
          };

          const rewriteHandleError = () => {
            rewriteCleanup?.();
            streamingMessageIdRef.current = null;
            streamingBufferRef.current = '';
            setLoadingState('error');
            abortControllerRef.current = null;
          };

          window.addEventListener('sse-token', rewriteHandleToken);
          window.addEventListener('sse-complete', rewriteHandleComplete);
          window.addEventListener('sse-error', rewriteHandleError);
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

        const controller = createSSEConnection(
          apiEndpoint,
          apiKey,
          modelName,
          chatMessages,
          { temperature, topP },
        );

        abortControllerRef.current = controller;

        const handleToken = (e: Event) => {
          const content = (e as CustomEvent<{ content: string }>).detail.content;
          streamingBufferRef.current += content;

          const result = parseMessageSegments(streamingBufferRef.current);
          if (result.isValid && result.segments.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? { ...m, segments: result.segments, rawText: streamingBufferRef.current }
                  : m,
              ),
            );
          }
        };

        const handleComplete = async () => {
          cleanup();
          const finalBuffer = streamingBufferRef.current;

          try {
            const parserWorker = new ParserWorker();
            const { segments, isValid } = await new Promise<{ segments: any[], isValid: boolean }>((resolve, reject) => {
              parserWorker.onmessage = (workerEvent: MessageEvent) => resolve(workerEvent.data);
              parserWorker.onerror = (err) => reject(err);
              parserWorker.postMessage({ id: aiMessage.id, rawText: finalBuffer });
            });

            try {
              await updateMessage(aiMessage.id, {
                rawText: finalBuffer,
                segments: isValid ? segments : [],
                status: 'completed',
              });
            } catch (dbError) {
              console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
            }

            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? {
                      ...m,
                      rawText: finalBuffer,
                      segments: isValid ? segments : [],
                      status: 'completed' as const,
                    }
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
          } catch (parseError) {
            console.error('Parser worker error:', parseError);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? { ...m, rawText: finalBuffer, status: 'completed' as const }
                  : m,
              ),
            );
          }

          setLoadingState('idle');
          streamingMessageIdRef.current = null;
        };

        const handleError = () => {
          cleanup();
          setLoadingState('error');
          streamingMessageIdRef.current = null;
          streamingBufferRef.current = '';
        };

        const cleanup = () => {
          abortControllerRef.current?.abort();
          window.removeEventListener('sse-token', handleToken);
          window.removeEventListener('sse-complete', handleComplete);
          window.removeEventListener('sse-error', handleError);
        };

        window.addEventListener('sse-token', handleToken);
        window.addEventListener('sse-complete', handleComplete);
        window.addEventListener('sse-error', handleError);
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

        const controller = createSSEConnection(
          apiEndpoint,
          apiKey,
          modelName,
          chatMessages,
          { temperature, topP },
        );

        abortControllerRef.current = controller;

        const handleToken = (e: Event) => {
          const content = (e as CustomEvent<{ content: string }>).detail.content;
          streamingBufferRef.current += content;

          const result = parseMessageSegments(streamingBufferRef.current);
          if (result.isValid && result.segments.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? { ...m, segments: result.segments, rawText: streamingBufferRef.current }
                  : m,
              ),
            );
          }
        };

        const handleComplete = async () => {
          cleanup();
          const finalBuffer = streamingBufferRef.current;

          try {
            const parserWorker = new ParserWorker();
            const { segments, isValid } = await new Promise<{ segments: any[], isValid: boolean }>((resolve, reject) => {
              parserWorker.onmessage = (workerEvent: MessageEvent) => resolve(workerEvent.data);
              parserWorker.onerror = (err) => reject(err);
              parserWorker.postMessage({ id: aiMessage.id, rawText: finalBuffer });
            });

            try {
              await updateMessage(aiMessage.id, {
                rawText: finalBuffer,
                segments: isValid ? segments : [],
                status: 'completed',
              });
            } catch (dbError) {
              console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
            }

            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? {
                      ...m,
                      rawText: finalBuffer,
                      segments: isValid ? segments : [],
                      status: 'completed' as const,
                    }
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
          } catch (parseError) {
            console.error('Parser worker error:', parseError);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessage.id
                  ? { ...m, rawText: finalBuffer, status: 'completed' as const }
                  : m,
              ),
            );
          }

          setLoadingState('idle');
          streamingMessageIdRef.current = null;
        };

        const handleError = () => {
          cleanup();
          setLoadingState('error');
          streamingMessageIdRef.current = null;
          streamingBufferRef.current = '';
        };

        const cleanup = () => {
          abortControllerRef.current?.abort();
          window.removeEventListener('sse-token', handleToken);
          window.removeEventListener('sse-complete', handleComplete);
          window.removeEventListener('sse-error', handleError);
        };

        window.addEventListener('sse-token', handleToken);
        window.addEventListener('sse-complete', handleComplete);
        window.addEventListener('sse-error', handleError);
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

        const response = await fetch(save.metadata.configSnapshot.network.apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${save.metadata.configSnapshot.network.apiKey}`,
          },
          body: JSON.stringify({
            model: save.metadata.configSnapshot.network.modelName,
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

      const controller = createSSEConnection(
        apiEndpoint,
        apiKey,
        modelName,
        chatMessages,
        { temperature, topP },
      );

      abortControllerRef.current = controller;

      const handleToken = (e: Event) => {
        const content = (e as CustomEvent<{ content: string }>).detail.content;
        streamingBufferRef.current += content;

        const result = parseMessageSegments(streamingBufferRef.current);
        if (result.isValid && result.segments.length > 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? { ...m, segments: result.segments, rawText: streamingBufferRef.current }
                : m,
            ),
          );
        }
      };

      const handleComplete = async () => {
        cleanup();
        const finalBuffer = streamingBufferRef.current;

        try {
          const parserWorker = new ParserWorker();
          const { segments, isValid } = await new Promise<{ segments: any[], isValid: boolean }>((resolve, reject) => {
            parserWorker.onmessage = (workerEvent: MessageEvent) => resolve(workerEvent.data);
            parserWorker.onerror = (err) => reject(err);
            parserWorker.postMessage({ id: aiMessage.id, rawText: finalBuffer });
          });

          try {
            await updateMessage(aiMessage.id, {
              rawText: finalBuffer,
              segments: isValid ? segments : [],
              status: 'completed',
            });
          } catch (dbError) {
            console.warn('[GameView] 更新AI消息到数据库失败:', dbError);
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? {
                    ...m,
                    rawText: finalBuffer,
                    segments: isValid ? segments : [],
                    status: 'completed' as const,
                  }
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
        } catch (parseError) {
          console.error('Continue parser worker error:', parseError);
          try {
            await updateMessage(aiMessage.id, { status: 'completed', rawText: finalBuffer, segments: [] });
          } catch {}
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? { ...m, status: 'completed' as const, rawText: finalBuffer, segments: [] }
                : m,
            ),
          );
        }

        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
        setLoadingState('idle');

        checkAndTriggerCompression(roundIndex);
      };

      const handleError = (e: Event) => {
        cleanup();
        const detail = (e as CustomEvent<{ status: number; message: string }>).detail;

        try {
          updateMessage(aiMessage.id, { status: 'error' });
        } catch {}

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessage.id ? { ...m, status: 'error' as const } : m,
          ),
        );

        console.error('Continue SSE Error:', detail);
        streamingMessageIdRef.current = null;
        streamingBufferRef.current = '';
        setLoadingState('error');
      };

      const cleanup = () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        window.removeEventListener('sse-token', handleToken);
        window.removeEventListener('sse-complete', handleComplete);
        window.removeEventListener('sse-error', handleError);
      };

      window.addEventListener('sse-token', handleToken);
      window.addEventListener('sse-complete', handleComplete);
      window.addEventListener('sse-error', handleError);
    } catch (err) {
      console.error('[GameView] handleContinueStory 异常:', err);
      // 只在真正的 API 错误时显示错误提示
      if (String(err).includes('SSE') || String(err).includes('fetch')) {
        setLoadingState('error');
      }
      streamingMessageIdRef.current = null;
      streamingBufferRef.current = '';
    }
  }, [currentRound, save, messages, loadingState, getNetworkConfig]);

  const handleEditSave = useCallback(async (editedText: string) => {
    if (!editingMessage) return;

    console.log('[GameView] handleEditSave 开始保存编辑:', {
      messageId: editingMessage.id,
      role: editingMessage.role,
      editedTextLength: editedText.length,
    });

    try {
      await updateMessage(editingMessage.id, {
        rawText: editedText,
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === editingMessage.id
            ? { ...m, rawText: editedText }
            : m,
        ),
      );

      console.log('[GameView] handleEditSave 保存成功');

      if (editingMessage.role === 'user') {
        console.log('[GameView] 用户消息已编辑，将触发重新生成AI回复');
        const aiMsg = messages.find(
          (m) => m.roundIndex === editingMessage.roundIndex && m.role === 'ai',
        );

        if (aiMsg) {
          await deleteMessage(aiMsg.id);
          setMessages((prev) => prev.filter((m) => m.id !== aiMsg.id));
        }

        setEditingMessage(null);
        handleSendMessage(editedText);
      } else {
        setEditingMessage(null);
      }
    } catch (dbError) {
      console.error('[GameView] handleEditSave 保存失败:', dbError);
    }
  }, [editingMessage, messages, handleSendMessage]);

  handleContinueStoryRef.current = handleContinueStory;

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
        />
      </div>

      {contextMenuTarget && (
        <ContextMenu
          message={contextMenuTarget}
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
