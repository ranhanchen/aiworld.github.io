import { useEffect, useState, useCallback } from 'react';
import type { Save } from '@/types/save';
import { getAllSaves, deleteSave, exportSaves } from '@/db/repository';
import SaveCard from '@/components/SaveManager/SaveCard';
import ImportExport from '@/components/SaveManager/ImportExport';
import ConfirmDialog from '@/components/Common/ConfirmDialog';

interface SaveListProps {
  onPlaySave: (save: Save) => void;
  onEditSave: (save: Save) => void;
  onCreateNew: () => void;
}

type ViewState = 'loading' | 'loaded' | 'empty' | 'error';

export default function SaveList({ onPlaySave, onEditSave, onCreateNew }: SaveListProps) {
  const [saves, setSaves] = useState<Save[]>([]);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const loadSaves = useCallback(async () => {
    setViewState('loading');
    try {
      const allSaves = await getAllSaves();
      setSaves(allSaves);
      setViewState(allSaves.length === 0 ? 'empty' : 'loaded');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setViewState('error');
    }
  }, []);

  useEffect(() => {
    loadSaves();
  }, [loadSaves]);

  const handleDelete = useCallback(async (id: string) => {
    setConfirmDialog({
      message: '确定要删除这个存档吗？删除后无法恢复。',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteSave(id);
          setSaves((prev) => prev.filter((s) => s.id !== id));
        } catch (e) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }, []);

  const handleDownload = useCallback(async (save: Save) => {
    try {
      const jsonStr = await exportSaves([save.id]);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (save.metadata.title || `存档_${save.id}`).replace(/[^a-zA-Z0-9一-龥_-]/g, '_');
      a.download = `${safeName}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  if (viewState === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-lg text-text-secondary dark:text-text-secondary-dark">
            正在加载存档...
          </span>
        </div>
      </div>
    );
  }

  if (viewState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-red-500 text-lg">{errorMessage}</div>
        <button
          onClick={loadSaves}
          className="px-4 py-2 bg-accent text-white rounded-lg text-lg hover:opacity-90 transition-opacity"
        >
          重试
        </button>
      </div>
    );
  }

  if (viewState === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <svg className="w-12 h-12 text-gray-400 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <p className="text-text-secondary dark:text-text-secondary-dark text-lg">
          暂无存档，开始你的冒险吧
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCreateNew}
            className="px-4 py-2 bg-accent text-white rounded-lg text-lg hover:opacity-90 transition-opacity"
          >
            新建存档
          </button>
          <button
            onClick={() => setShowImportExport(!showImportExport)}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-text-primary dark:text-text-primary-dark rounded-lg text-lg hover:opacity-90 transition-opacity"
          >
            导入存档
          </button>
        </div>
        {showImportExport && <ImportExport onComplete={loadSaves} />}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">你的冒险</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImportExport(!showImportExport)}
            className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-text-primary dark:text-text-primary-dark rounded-lg text-base hover:opacity-90 transition-opacity"
          >
            导入
          </button>
          <button
            onClick={onCreateNew}
            className="px-3 py-1.5 bg-accent text-white rounded-lg text-base hover:opacity-90 transition-opacity"
          >
            新建存档
          </button>
        </div>
      </div>

      {showImportExport && <ImportExport onComplete={loadSaves} />}

      <div className="grid grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-4 gap-3">
        {saves.map((save) => (
          <SaveCard
            key={save.id}
            save={save}
            onClick={onPlaySave}
            onEdit={onEditSave}
            onDelete={handleDelete}
            onDownload={handleDownload}
          />
        ))}
      </div>

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
