import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameConfig } from '@/types/config';
import { getActiveApi } from '@/types/config';
import { createNonStreamingRequest } from '@/config/api';
import { FONT_SIZE_CLASS_MAP } from '@/config/constants';
import VirtualMessageList from '@/components/GameInterface/VirtualMessageList';
import InputArea from '@/components/GameInterface/InputArea';
import ContextMenu from '@/components/GameInterface/ContextMenu';
import ConfirmDialog from '@/components/Common/ConfirmDialog';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

interface ChatViewProps {
  config: GameConfig;
  onOpenSettings: () => void;
  onBack: () => void;
  onUpdateConfig: (config: GameConfig) => void;
}

type LoadingState = 'idle' | 'sending' | 'error';

const CHAT_STORAGE_KEY = 'ta_chat_messages';

function loadChatMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveChatMessages(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  } catch {}
}

function chatMessageToGameMessage(msg: ChatMessage) {
  return {
    id: msg.id,
    saveId: '__chat__',
    roundIndex: 0,
    role: msg.role === 'user' ? 'user' as const : 'ai' as const,
    rawText: msg.content,
    segments: msg.role === 'assistant'
      ? [{ type: 'scene' as const, content: msg.content }]
      : [],
    status: 'completed' as const,
    createdAt: msg.createdAt,
    updatedAt: msg.createdAt,
    isCompressedAnchor: false,
  };
}

export default function ChatView({ config, onOpenSettings, onBack, onUpdateConfig }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatMessages());
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [contextMenuTarget, setContextMenuTarget] = useState<ChatMessage | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const INPUT_DRAFT_KEY = 'ta_chat_input_draft';
  const [inputDraft, setInputDraft] = useState<string>(() => {
    try { return localStorage.getItem(INPUT_DRAFT_KEY) || ''; } catch { return ''; }
  });

  const handleInputDraftChange = useCallback((text: string) => {
    setInputDraft(text);
    try { localStorage.setItem(INPUT_DRAFT_KEY, text); } catch {}
  }, []);

  useEffect(() => {
    saveChatMessages(messages);
  }, [messages]);

  const getNetworkConfig = useCallback(() => {
    const network = config.network;
    const activeApi = getActiveApi(network);
    if (activeApi && activeApi.apiKey && activeApi.apiEndpoint) {
      return {
        apiKey: activeApi.apiKey,
        apiEndpoint: activeApi.apiEndpoint,
        modelName: activeApi.modelName || '',
        temperature: activeApi.temperature ?? 0.8,
        topP: activeApi.topP ?? 0.95,
      };
    }
    return { apiKey: '', apiEndpoint: '', modelName: '', temperature: 0.8, topP: 0.95 };
  }, [config.network]);

  const handleSend = useCallback(async (text: string) => {
    const { apiEndpoint, apiKey, modelName, temperature, topP } = getNetworkConfig();
    if (!apiKey || !apiEndpoint) {
      setLoadingState('error');
      return;
    }
    if (loadingState === 'sending') return;

    const userMsg: ChatMessage = {
      id: `chat_u_${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };

    const aiMsg: ChatMessage = {
      id: `chat_a_${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: Date.now() + 1,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setLoadingState('sending');

    const chatHistory: Array<{ role: string; content: string }> = [
      ...messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: text },
    ];

    const { controller, response } = createNonStreamingRequest(
      apiEndpoint,
      apiKey,
      modelName,
      chatHistory,
      { temperature, topP },
    );

    abortControllerRef.current = controller;

    try {
      const fullText = await response;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsg.id ? { ...m, content: fullText } : m,
        ),
      );
      setLoadingState('idle');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[ChatView] API请求失败:', err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id ? { ...m, content: '（请求失败，请重试）' } : m,
          ),
        );
        setLoadingState('error');
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [messages, loadingState, getNetworkConfig]);

  const handleContextMenuAction = useCallback((action: string, message: ChatMessage) => {
    setContextMenuTarget(null);

    switch (action) {
      case 'copy': {
        try {
          navigator.clipboard.writeText(message.content);
        } catch {
          const textarea = document.createElement('textarea');
          textarea.value = message.content;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        break;
      }

      case 'delete': {
        setConfirmDialog({
          message: '确定要删除这条消息吗？',
          onConfirm: () => {
            setConfirmDialog(null);
            setMessages((prev) => prev.filter((m) => m.id !== message.id));
          },
        });
        break;
      }

      case 'resend': {
        if (message.role !== 'user') break;
        setConfirmDialog({
          message: '重新发送将删除此消息及之后的所有消息。确定要继续吗？',
          onConfirm: () => {
            setConfirmDialog(null);
            const targetIndex = messages.findIndex((m) => m.id === message.id);
            if (targetIndex === -1) return;
            const keptMessages = messages.slice(0, targetIndex);
            setMessages(keptMessages);
            setLoadingState('idle');
            setTimeout(() => handleSend(message.content), 100);
          },
        });
        break;
      }

      case 'regenerate': {
        if (message.role !== 'assistant') break;
        const prevUserMsg = messages[messages.indexOf(message) - 1];
        if (!prevUserMsg || prevUserMsg.role !== 'user') break;

        const filteredMessages = messages.filter((m) => m.createdAt < message.createdAt);
        setMessages(filteredMessages);
        setLoadingState('idle');
        setTimeout(() => handleSend(prevUserMsg.content), 100);
        break;
      }
    }
  }, [messages, handleSend]);

  const handleSelectApi = useCallback((apiId: string) => {
    const updatedNetwork = { ...config.network, selectedId: apiId };
    onUpdateConfig({ ...config, network: updatedNetwork });
  }, [config, onUpdateConfig]);

  const isSending = loadingState === 'sending';
  const fontSizeClass = FONT_SIZE_CLASS_MAP[config.system.fontSize] || 'text-base';
  const networkConfig = config.network;
  const apis = networkConfig.apis || [];
  const selectedApiId = networkConfig.selectedId || '';

  const gameMessages = messages.map(chatMessageToGameMessage);

  const contextMenuGameMessage = contextMenuTarget ? chatMessageToGameMessage(contextMenuTarget) : null;

  return (
    <div className="h-[100dvh] flex flex-col bg-surface dark:bg-surface-dark">
      <header className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark min-h-[44px] min-w-[44px]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden tablet:inline">返回</span>
        </button>

        <div className="text-center">
          <h1 className="text-sm font-semibold">AI 对话</h1>
        </div>

        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark min-h-[44px] min-w-[44px]"
          title="设置"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
          messages={gameMessages}
          onLoadMore={async () => false}
          hasMore={false}
          onMessageLongPress={(msg) => {
            const chatMsg = messages.find((m) => m.id === msg.id);
            if (chatMsg) setContextMenuTarget(chatMsg);
          }}
        />

        <InputArea
          onSend={handleSend}
          onContinue={() => {
            const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
            if (lastUserMsg) handleSend(lastUserMsg.content);
          }}
          disabled={isSending}
          apis={apis}
          selectedApiId={selectedApiId}
          onSelectApi={handleSelectApi}
          savedText={inputDraft}
          onTextChange={handleInputDraftChange}
        />
      </div>

      {contextMenuGameMessage && contextMenuTarget && (
        <ContextMenu
          message={contextMenuGameMessage}
          isLastAiMessage={messages.length > 0 && messages[messages.length - 1]?.id === contextMenuTarget.id && contextMenuTarget.role === 'assistant'}
          onAction={(action) => handleContextMenuAction(action, contextMenuTarget)}
          onClose={() => setContextMenuTarget(null)}
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
