import { useState, useEffect, useCallback } from 'react';
import type { Save } from '@/types/save';
import type { GameConfig } from '@/types/config';
import { createSave, getLatestSave, updateSave } from '@/db/repository';
import { COVER_COLORS } from '@/config/constants';
import SaveList from '@/components/SaveManager/SaveList';
import ConfigForm from '@/components/ConfigCenter/ConfigForm';
import GameView from '@/components/GameInterface/GameView';
import MemoryOverride from '@/components/MemoryPanel/MemoryOverride';

type AppScreen = 'saves' | 'config' | 'game';

function pickRandomCoverColor(): string {
  return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('saves');
  const [currentSave, setCurrentSave] = useState<Save | null>(null);
  const [configForNewSave, setConfigForNewSave] = useState<GameConfig | null>(null);
  const [editingSaveId, setEditingSaveId] = useState<string | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
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

  const handleCreateNew = useCallback(async () => {
    setEditingSaveId(null);
    const latest = await getLatestSave();
    if (latest) {
      setConfigForNewSave(latest.metadata.configSnapshot);
    }
    setScreen('config');
  }, []);

  const handleEditSave = useCallback((save: Save) => {
    setEditingSaveId(save.id);
    setConfigForNewSave(save.metadata.configSnapshot);
    setScreen('config');
  }, []);

  const handleSaveConfig = useCallback(
    async (config: GameConfig) => {
      if (editingSaveId) {
        const updated = await updateSave(editingSaveId, {
          metadata: { configSnapshot: config },
        });
        if (updated) {
          setCurrentSave(updated);
          try { localStorage.setItem(`save_backup_${editingSaveId}`, JSON.stringify(updated)); } catch {}
        }
      } else {
        const save = await createSave({
          metadata: {
            title: '',
            description: '',
            coverColor: pickRandomCoverColor(),
            configSnapshot: config,
          },
        });
        setCurrentSave(save);
        setEditingSaveId(save.id);
        try { localStorage.setItem(`save_backup_${save.id}`, JSON.stringify(save)); } catch {}
      }

      setSaveMessage('设定已保存');
      setTimeout(() => setSaveMessage(null), 2000);
    },
    [editingSaveId],
  );

  const handleClearMessage = useCallback(() => {
    setSaveMessage(null);
  }, []);

  const handleCancelConfig = useCallback(() => {
    setConfigForNewSave(null);
    setEditingSaveId(null);
    setScreen('saves');
  }, []);

  const handlePlaySave = useCallback((save: Save) => {
    console.log('[App] handlePlaySave 接收到的 save:', {
      id: save.id,
      'configSnapshot存在': !!save.metadata?.configSnapshot,
      'network存在': !!save.metadata?.configSnapshot?.network,
      'apiKey有值': !!save.metadata?.configSnapshot?.network?.apiKey,
      'apiKey长度': save.metadata?.configSnapshot?.network?.apiKey?.length,
    });
    setCurrentSave(save);
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

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showMemory) {
          handleCloseMemory();
        } else if (screen === 'config') {
          handleCancelConfig();
        }
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [screen, showMemory, handleCancelConfig, handleCloseMemory]);

  return (
    <div className="min-h-[100dvh] bg-surface dark:bg-surface-dark">
      {screen === 'saves' && (
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              文字冒险
            </h1>
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
            <h1 className="text-xl font-bold mb-6">
              {editingSaveId ? '编辑存档设定' : '新建存档设定'}
            </h1>
            <ConfigForm
              initialConfig={configForNewSave ?? undefined}
              onSave={handleSaveConfig}
              onCancel={handleCancelConfig}
              saveMessage={saveMessage}
              onClearMessage={handleClearMessage}
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
    </div>
  );
}
