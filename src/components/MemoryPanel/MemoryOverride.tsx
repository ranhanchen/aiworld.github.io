import { useState, useEffect, useCallback } from 'react';
import type { Save } from '@/types/save';
import type { Message } from '@/types/message';
import { updateSave } from '@/db/repository';
import ResizableTextarea from '@/components/UI/ResizableTextarea';

interface MemoryOverrideProps {
  save: Save;
  onClose: () => void;
  onSaveUpdate?: (updatedSave: Save) => void;
}

export default function MemoryOverride({ save, onClose, onSaveUpdate }: MemoryOverrideProps) {
  const [summary, setSummary] = useState(save.currentSummary);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [anchorMessage, setAnchorMessage] = useState<Message | null>(null);
  const [loadingAnchor, setLoadingAnchor] = useState(false);

  useEffect(() => {
    const loadAnchor = async () => {
      if (save.lastCompressedRound <= 0) return;

      setLoadingAnchor(true);
      try {
        const { getMessagesByRoundRange } = await import('@/db/repository');
        const anchorMessages = await getMessagesByRoundRange(
          save.id,
          save.lastCompressedRound,
          save.lastCompressedRound,
        );

        if (anchorMessages.length > 0) {
          setAnchorMessage(anchorMessages[0]);
        }
      } catch {
        console.error('Failed to load anchor message');
      } finally {
        setLoadingAnchor(false);
      }
    };

    loadAnchor();
  }, [save.id, save.lastCompressedRound]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSaveSummary = useCallback(async () => {
    setSaving(true);
    setMessage(null);

    try {
      const updated = await updateSave(save.id, { currentSummary: summary });
      if (updated) {
        setMessage({ type: 'success', text: '摘要保存成功' });
        onSaveUpdate?.(updated);
      } else {
        setMessage({ type: 'error', text: '保存失败，存档不存在' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage({ type: 'error', text: `保存失败: ${msg}` });
    } finally {
      setSaving(false);
    }
  }, [save.id, summary, onSaveUpdate]);

  const handleJumpToAnchor = useCallback(() => {
    if (!anchorMessage) return;

    const selector = `[data-message-id="${anchorMessage.id}"]`;
    const element = document.querySelector(selector);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('animate-pulse-highlight');
      setTimeout(() => {
        element.classList.remove('animate-pulse-highlight');
      }, 6000);
    }

    onClose();
  }, [anchorMessage, onClose]);

  const anchorText = anchorMessage
    ? anchorMessage.rawText.length > 20
      ? anchorMessage.rawText.slice(0, 20) + '…'
      : anchorMessage.rawText
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex" onClick={onClose}>
      <div
        className="ml-auto w-full max-w-md h-full bg-white dark:bg-gray-800 shadow-2xl flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">记忆管理面板</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-[44px] min-w-[44px]"
            title="关闭 (Esc)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">当前摘要 (可手动编辑)</h3>
            <p className="text-base text-text-secondary dark:text-text-secondary-dark mb-2">
              你可以直接修改摘要内容来干预AI的记忆走向
            </p>
            <ResizableTextarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-lg focus:outline-none focus:ring-2 focus:ring-accent font-mono"
              placeholder="摘要为空时，AI将仅依赖最近的对话上下文..."
              minHeight={150}
            />
            {message && (
              <p
                className={`mt-2 text-base ${
                  message.type === 'success'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500'
                }`}
              >
                {message.text}
              </p>
            )}
          </div>

          {save.lastCompressedRound > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-semibold mb-2">时空锚点</h3>
              {loadingAnchor ? (
                <p className="text-xs text-text-secondary">加载锚点信息...</p>
              ) : anchorMessage ? (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                    已压缩至第 {save.lastCompressedRound} 轮
                  </p>
                  <p className="text-xs mt-1 text-text-primary dark:text-text-primary-dark truncate">
                    消息内容：{anchorText}
                  </p>
                  <button
                    onClick={handleJumpToAnchor}
                    className="mt-2 w-full px-3 py-2 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity min-h-[44px]"
                  >
                    定位至该节点
                  </button>
                </div>
              ) : (
                <p className="text-xs text-text-secondary">
                  锚点消息已丢失或尚未创建
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleSaveSummary}
            disabled={saving}
            className={`w-full px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity min-h-[44px] ${
              saving ? 'opacity-50' : ''
            }`}
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
