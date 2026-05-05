import { useState, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import type { Save } from '@/types/save';
import type { GameConfig } from '@/types/config';
import { getActiveApi } from '@/types/config';
import { createSave, getLatestSave, getSave, updateSave, diagnoseDatabase } from '@/db/repository';
import { COVER_COLORS, DEFAULT_GAME_CONFIG } from '@/config/constants';
import SaveList from '@/components/SaveManager/SaveList';
import ConfigForm from '@/components/ConfigCenter/ConfigForm';
import GameView from '@/components/GameInterface/GameView';
import ChatView from '@/components/ChatInterface/ChatView';
import MemoryOverride from '@/components/MemoryPanel/MemoryOverride';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class GlobalErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[App] 全局错误边界捕获异常:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-surface dark:bg-surface-dark p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark mb-2">
              应用遇到了问题
            </h2>
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
              发生了一个意外错误，你的数据应该没有丢失。请尝试刷新页面。
            </p>
            <p className="text-xs text-red-500 dark:text-red-400 mb-4 font-mono break-all">
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity min-h-[44px]"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type AppScreen = 'saves' | 'config' | 'game' | 'chat' | 'chatConfig';

function loadChatConfig(): GameConfig {
  try {
    const raw = localStorage.getItem('ta_chat_config');
    if (raw) {
      return JSON.parse(raw) as GameConfig;
    }
  } catch {}
  return { ...DEFAULT_GAME_CONFIG };
}

function saveChatConfig(config: GameConfig): void {
  try {
    localStorage.setItem('ta_chat_config', JSON.stringify(config));
  } catch {}
}

function pickRandomCoverColor(): string {
  return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('saves');
  const [currentSave, setCurrentSave] = useState<Save | null>(null);
  const [configForNewSave, setConfigForNewSave] = useState<GameConfig | null>(null);
  const [editingSaveId, setEditingSaveId] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState<string>('');
  const [showMemory, setShowMemory] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [chatConfig, setChatConfig] = useState<GameConfig>(() => loadChatConfig());
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem('theme');
      if (!stored) {
        setDarkMode(e.matches);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        console.warn('Service Worker registration failed');
      });
    }
  }, []);

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[App] 未处理的Promise拒绝:', event.reason);
      event.preventDefault();
    };
    const handleUnhandledError = (event: ErrorEvent) => {
      console.error('[App] 未处理的错误:', event.error || event.message);
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleUnhandledError);

    (window as any).diagnoseDatabase = diagnoseDatabase;

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleUnhandledError);
    };
  }, []);

  const handleCreateNew = useCallback(async () => {
    setEditingSaveId(null);
    setSaveTitle('');
    const latest = await getLatestSave();
    if (latest) {
      setConfigForNewSave(latest.metadata.configSnapshot);
    }
    setScreen('config');
  }, []);

  const handleEditSave = useCallback((save: Save) => {
    setEditingSaveId(save.id);
    setSaveTitle(save.metadata.title || '');
    setConfigForNewSave(save.metadata.configSnapshot);
    setScreen('config');
  }, []);

  const handleSaveConfig = useCallback(
    async (config: GameConfig) => {
      try {
        const cleanConfig: GameConfig = {
          ...config,
          world: { ...config.world, customFields: Object.fromEntries(Object.entries(config.world.customFields).filter(([k]) => !k.startsWith('__new_') && k.trim() !== '')) },
          aiRestriction: { ...config.aiRestriction, customFields: Object.fromEntries(Object.entries(config.aiRestriction.customFields).filter(([k]) => !k.startsWith('__new_') && k.trim() !== '')) },
          character: { ...config.character, customFields: Object.fromEntries(Object.entries(config.character.customFields).filter(([k]) => !k.startsWith('__new_') && k.trim() !== '')) },
          winCondition: { ...config.winCondition, customFields: Object.fromEntries(Object.entries(config.winCondition.customFields).filter(([k]) => !k.startsWith('__new_') && k.trim() !== '')) },
        };

        if (editingSaveId) {
          const updated = await updateSave(editingSaveId, {
            metadata: { title: saveTitle, configSnapshot: cleanConfig },
          });
          if (updated) {
            setCurrentSave(updated);
            try { localStorage.setItem(`save_backup_${editingSaveId}`, JSON.stringify(updated)); } catch {}
          } else {
            try {
              const backup = localStorage.getItem(`save_backup_${editingSaveId}`);
              if (backup) {
                const backupSave = JSON.parse(backup) as Save;
                const patched: Save = {
                  ...backupSave,
                  metadata: { ...backupSave.metadata, title: saveTitle, configSnapshot: cleanConfig },
                  updatedAt: Date.now(),
                };
                setCurrentSave(patched);
                localStorage.setItem(`save_backup_${editingSaveId}`, JSON.stringify(patched));
              }
            } catch {}
            setSaveMessage('数据库保存失败，已备份到本地');
            setTimeout(() => setSaveMessage(null), 3000);
            return;
          }
        } else {
          const save = await createSave({
            metadata: {
              title: saveTitle,
              description: '',
              coverColor: pickRandomCoverColor(),
              configSnapshot: cleanConfig,
            },
          });
          setCurrentSave(save);
          setEditingSaveId(save.id);
          try { localStorage.setItem(`save_backup_${save.id}`, JSON.stringify(save)); } catch {}
        }

        setSaveMessage('设定已保存');
        setTimeout(() => setSaveMessage(null), 2000);
      } catch (err) {
        console.error('[App] handleSaveConfig 异常:', err);
        try {
          const emergencyConfig = JSON.stringify(config);
          localStorage.setItem('ta_emergency_config', emergencyConfig);
        } catch {}
        setSaveMessage('保存失败，配置已临时备份。请刷新页面重试: ' + (err instanceof Error ? err.message : String(err)));
        setTimeout(() => setSaveMessage(null), 5000);
      }
    },
    [editingSaveId, saveTitle],
  );

  const handleClearMessage = useCallback(() => {
    setSaveMessage(null);
  }, []);

  const handleCancelConfig = useCallback(() => {
    setConfigForNewSave(null);
    setEditingSaveId(null);
    setSaveTitle('');
    setScreen('saves');
  }, []);

  const handlePlaySave = useCallback(async (save: Save) => {
    // 从数据库重新加载以确保获取最新的 configSnapshot
    const freshSave = await getSave(save.id);
    const targetSave = freshSave || save;

    const activeApi = getActiveApi(targetSave.metadata?.configSnapshot?.network);
    console.log('[App] handlePlaySave 接收到的 save:', {
      id: targetSave.id,
      'configSnapshot存在': !!targetSave.metadata?.configSnapshot,
      'network存在': !!targetSave.metadata?.configSnapshot?.network,
      'apiKey有值': !!activeApi?.apiKey,
      'apiKey长度': activeApi?.apiKey?.length,
      '从数据库重新加载': !!freshSave,
    });

    // 如果 API 配置为空，尝试从 localStorage 备份恢复
    if (!activeApi?.apiKey) {
      try {
        const raw = localStorage.getItem(`save_backup_${targetSave.id}`);
        if (raw) {
          const backup: Save = JSON.parse(raw);
          const backupApi = getActiveApi(backup.metadata?.configSnapshot?.network);
          if (backupApi?.apiKey) {
            console.log('[App] 从 localStorage 备份恢复 API 配置');
            setCurrentSave(backup);
            setScreen('game');
            return;
          }
        }
      } catch (e) {
        console.warn('[App] localStorage 备份读取失败:', e);
      }
    }

    setCurrentSave(targetSave);
    setScreen('game');
  }, []);

  const handleBackToMenu = useCallback(() => {
    setCurrentSave(null);
    setScreen('saves');
  }, []);

  const handleOpenMemory = useCallback(() => {
    setShowMemory(true);
  }, []);

  const handleCloseMemory = useCallback(() => {
    setShowMemory(false);
  }, []);

  const handleMemorySaveUpdate = useCallback((updatedSave: Save) => {
    setCurrentSave(updatedSave);
  }, []);

  const handleOpenChat = useCallback(async () => {
    let cfg = loadChatConfig();
    const activeApi = getActiveApi(cfg.network);
    if (!activeApi?.apiKey) {
      try {
        const latest = await getLatestSave();
        if (latest?.metadata?.configSnapshot?.network) {
          const latestApi = getActiveApi(latest.metadata.configSnapshot.network);
          if (latestApi?.apiKey) {
            cfg = { ...latest.metadata.configSnapshot };
            saveChatConfig(cfg);
          }
        }
      } catch {}
    }
    setChatConfig(cfg);
    setScreen('chat');
  }, []);

  const handleOpenChatSettings = useCallback(() => {
    setScreen('chatConfig');
  }, []);

  const handleSaveChatConfig = useCallback((newConfig: GameConfig) => {
    setChatConfig(newConfig);
    saveChatConfig(newConfig);
    setSaveMessage('设置已保存');
    setTimeout(() => setSaveMessage(null), 2000);
    setScreen('chat');
  }, []);

  const handleCancelChatConfig = useCallback(() => {
    setScreen('chat');
  }, []);

  const handleUpdateChatConfig = useCallback((newConfig: GameConfig) => {
    setChatConfig(newConfig);
    saveChatConfig(newConfig);
  }, []);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showMemory) {
          handleCloseMemory();
        } else if (screen === 'config') {
          handleCancelConfig();
        } else if (screen === 'chatConfig') {
          handleCancelChatConfig();
        }
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [screen, showMemory, handleCancelConfig, handleCloseMemory, handleCancelChatConfig]);

  return (
    <GlobalErrorBoundary>
    <div className="min-h-[100dvh] bg-surface dark:bg-surface-dark">
      {screen === 'saves' && (
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              文字冒险
            </h1>
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenChat}
                className="px-2.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
              >
                AI 对话
              </button>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-h-[44px] min-w-[44px]"
                title="切换主题"
              >
              {darkMode ? (
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
            </div>
          </div>

          <SaveList
            onPlaySave={handlePlaySave}
            onEditSave={handleEditSave}
            onCreateNew={handleCreateNew}
          />
        </div>
      )}

      {screen === 'config' && (
        <div className="min-h-[100dvh] bg-surface dark:bg-surface-dark">
          <div className="max-w-3xl mx-auto px-4 py-6">
            <button
              onClick={handleCancelConfig}
              className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark mb-4 min-h-[44px] min-w-[44px]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>返回主页</span>
            </button>
            <h1 className="text-xl font-bold mb-6">
              {editingSaveId ? '编辑存档设定' : '新建存档设定'}
            </h1>
            <ConfigForm
              initialConfig={configForNewSave ?? undefined}
              onSave={handleSaveConfig}
              onCancel={handleCancelConfig}
              saveMessage={saveMessage}
              onClearMessage={handleClearMessage}
              saveTitle={saveTitle}
              onSaveTitleChange={setSaveTitle}
            />
          </div>
        </div>
      )}

      {screen === 'game' && currentSave && (
        <>
          <GameView
            save={currentSave}
            onOpenMemory={handleOpenMemory}
            onBackToMenu={handleBackToMenu}
          />
          {showMemory && (
            <MemoryOverride
              save={currentSave}
              onClose={handleCloseMemory}
              onSaveUpdate={handleMemorySaveUpdate}
            />
          )}
        </>
      )}

      {screen === 'chat' && (
        <ChatView
          config={chatConfig}
          onOpenSettings={handleOpenChatSettings}
          onBack={handleBackToMenu}
          onUpdateConfig={handleUpdateChatConfig}
        />
      )}

      {screen === 'chatConfig' && (
        <div className="min-h-[100dvh] bg-surface dark:bg-surface-dark">
          <div className="max-w-3xl mx-auto px-4 py-6">
            <button
              onClick={handleCancelChatConfig}
              className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark mb-4 min-h-[44px] min-w-[44px]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>返回对话</span>
            </button>
            <h1 className="text-xl font-bold mb-6">
              对话设置
            </h1>
            <ConfigForm
              initialConfig={chatConfig}
              onSave={handleSaveChatConfig}
              onCancel={handleCancelChatConfig}
              saveMessage={saveMessage}
              onClearMessage={handleClearMessage}
              chatMode
            />
          </div>
        </div>
      )}
    </div>
    </GlobalErrorBoundary>
  );
}
