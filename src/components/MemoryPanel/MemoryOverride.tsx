import { useState, useEffect, useCallback } from 'react';
import type { Save } from '@/types/save';
import type { Message } from '@/types/message';
import { getActiveApi } from '@/types/config';
import { updateSave, getMessagesByRoundRange } from '@/db/repository';
import { createNonStreamingRequest, DEFAULT_COMPRESSION_PROMPT } from '@/config/api';
import ResizableTextarea from '@/components/UI/ResizableTextarea';
import ConfirmDialog from '@/components/Common/ConfirmDialog';

interface MemoryOverrideProps {
  save: Save;
  onClose: () => void;
  onSaveUpdate?: (updatedSave: Save) => void;
}

export default function MemoryOverride({ save, onClose, onSaveUpdate }: MemoryOverrideProps) {
  const [summary, setSummary] = useState(save.currentSummary);
  const [saving, setSaving] = useState(false);
  const [displayMessages, setDisplayMessages] = useState<Message[]>([]);
  const [selectedRounds, setSelectedRounds] = useState<Set<number>>(new Set());
  const [liveSave, setLiveSave] = useState(save);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [compressionPrompt, setCompressionPrompt] = useState(liveSave.compressionPrompt || DEFAULT_COMPRESSION_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // 当 liveSave 从 DB 加载后，同步 compressionPrompt
  useEffect(() => {
    if (liveSave.compressionPrompt !== undefined) {
      setCompressionPrompt(liveSave.compressionPrompt || DEFAULT_COMPRESSION_PROMPT);
    }
  }, [liveSave.compressionPrompt]);

  const firstUnsummarizedRound = Math.max(1, (liveSave.lastCompressedRound || 0) + 1);
  const hasUnsummarizedContent = firstUnsummarizedRound <= liveSave.metadata.roundCount;
  const selectedCount = selectedRounds.size;

  const networkConfig = (() => {
    const network = save.metadata.configSnapshot?.network;
    if (!network) return null;
    const activeApi = getActiveApi(network);
    if (!activeApi?.apiKey || !activeApi?.apiEndpoint) return null;
    return {
      apiKey: activeApi.apiKey,
      apiEndpoint: activeApi.apiEndpoint,
      modelName: activeApi.modelName || '',
      temperature: activeApi.temperature ?? 0.8,
      topP: activeApi.topP ?? 0.95,
    };
  })();

  // 挂载时从 DB 读取最新 save 数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getSave } = await import('@/db/repository');
        const latest = await getSave(save.id);
        if (latest && !cancelled) setLiveSave(latest);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [save.id]);

  // 加载消息列表
  useEffect(() => {
    if (!hasUnsummarizedContent) return;
    (async () => {
      setLoadingMessages(true);
      try {
        const msgs = await getMessagesByRoundRange(save.id, firstUnsummarizedRound, liveSave.metadata.roundCount);
        setDisplayMessages(msgs);
      } catch (e) {
        console.error('获取未压缩消息失败:', e);
      } finally {
        setLoadingMessages(false);
      }
    })();
  }, [save.id, firstUnsummarizedRound, liveSave.metadata.roundCount, hasUnsummarizedContent]);

  // 禁止关闭
  const handleClose = useCallback(() => {
    if (isSummarizing) return;
    onClose();
  }, [isSummarizing, onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleClose]);

  // checkbox 点击
  const handleCheck = useCallback((msg: Message) => {
    if (msg.roundIndex <= liveSave.lastCompressedRound) return; // 已压缩
    setSelectedRounds(prev => {
      const next = new Set(prev);
      if (next.has(msg.roundIndex)) {
        next.delete(msg.roundIndex);
      } else {
        const maxSelected = Math.max(...next, firstUnsummarizedRound - 1);
        for (let r = maxSelected + 1; r <= msg.roundIndex; r++) {
          next.add(r);
        }
      }
      return next;
    });
  }, [liveSave.lastCompressedRound, firstUnsummarizedRound]);

  // 保存
  const handleSaveSummary = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updateFields: Parameters<typeof updateSave>[1] = { currentSummary: summary };
      if (selectedRounds.size > 0) {
        const lastRound = Math.max(...selectedRounds);
        if (lastRound > (liveSave.lastCompressedRound || 0)) {
          updateFields.lastCompressedRound = lastRound;
        }
      }
      const updated = await updateSave(save.id, updateFields);
      if (updated) {
        setMessage({ type: 'success', text: '摘要保存成功' });
        setLiveSave(updated);
        onSaveUpdate?.(updated);
      } else {
        setMessage({ type: 'error', text: '保存失败，存档不存在' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: `保存失败: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  }, [liveSave, summary, selectedRounds, onSaveUpdate]);

  // 一键总结
  const handleOneClickSummary = useCallback(async () => {
    if (!networkConfig || selectedRounds.size === 0) return;
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const selectedMsgs = displayMessages.filter(m => selectedRounds.has(m.roundIndex));
      const messagesText = selectedMsgs
        .map(m => (m.role === 'user' ? '【玩家】' : '【AI】') + (m.rawText || ''))
        .join('\n\n---\n\n');
      const systemContent = compressionPrompt || DEFAULT_COMPRESSION_PROMPT;
      const userContent = `${liveSave.currentSummary ? `## 已有摘要（若存在）
${liveSave.currentSummary}

` : ''}## 需要压缩的对话内容
${messagesText}`;
      const { response } = createNonStreamingRequest(
        networkConfig.apiEndpoint,
        networkConfig.apiKey,
        networkConfig.modelName,
        [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        { temperature: 0.3, topP: 0.9 },
      );
      const result = await response;
      setSummary(result);
    } catch (e) {
      setSummaryError(`AI总结失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSummarizing(false);
    }
  }, [networkConfig, displayMessages, selectedRounds, liveSave.currentSummary, compressionPrompt]);

  // 重置
  const handleReset = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      const updated = await updateSave(save.id, { currentSummary: '', lastCompressedRound: 0 });
      if (updated) {
        setSummary('');
        setSelectedRounds(new Set());
        setLiveSave(updated);
        onSaveUpdate?.(updated);
      }
    } catch (e) {
      setMessage({ type: 'error', text: `重置失败: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [save.id, onSaveUpdate]);

  return (
    <>
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={handleClose}>
      <div
        className="w-[90vw] h-[90vh] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">记忆管理面板</h2>
          <button
            onClick={handleClose}
            disabled={isSummarizing}
            className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-[44px] min-w-[44px] ${isSummarizing ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={isSummarizing ? '总结中，无法关闭' : '关闭 (Esc)'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* 摘要编辑框 */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">当前摘要 (可手动编辑)</h3>
            <ResizableTextarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-lg focus:outline-none focus:ring-2 focus:ring-accent font-mono"
              placeholder="摘要为空时，AI将仅依赖最近的对话上下文..."
              minHeight={150}
            />
            {message && (
              <p className={`mt-2 text-base ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {message.text}
              </p>
            )}
            <button
              onClick={handleSaveSummary}
              disabled={saving}
              className={`w-full mt-3 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity min-h-[44px] ${saving ? 'opacity-50' : ''}`}
            >
              {saving ? '保存中...' : '保存修改'}
            </button>
          </div>

          {/* 消息列表（替代滑块） */}
          {hasUnsummarizedContent && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-4">
              <h3 className="text-base font-semibold mb-3">选择要压缩的对话</h3>
              {loadingMessages ? (
                <p className="text-sm text-text-secondary">加载消息中...</p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto mb-3">
                  {displayMessages.map(msg => {
                    const isCompressed = msg.roundIndex <= liveSave.lastCompressedRound;
                    const isSelected = selectedRounds.has(msg.roundIndex);
                    const maxSelected = Math.max(...selectedRounds, 0);
                    const isSkipped = !isCompressed && !isSelected && selectedRounds.size > 0
                      && msg.roundIndex > liveSave.lastCompressedRound
                      && msg.roundIndex <= maxSelected;

                    return (
                      <div
                        key={msg.roundIndex}
                        className={`flex items-start gap-2 p-2 rounded-lg ${
                          isCompressed || isSkipped ? 'opacity-50' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isCompressed || isSelected}
                          disabled={isCompressed || isSkipped}
                          onChange={() => handleCheck(msg)}
                          className="mt-1 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">
                              第{msg.roundIndex}轮 {msg.role === 'user' ? '玩家' : 'AI'}
                              {isCompressed && '·已压缩'}
                              {isSelected && '·已选择'}
                              {isSkipped && '·已跳过'}
                            </span>
                          </div>
                          <p className="text-sm truncate text-text-primary dark:text-text-primary-dark">
                            {(msg.rawText || '').slice(0, 80)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-text-secondary mb-2">
                已选 {selectedCount} 条
                {selectedCount > 0 && `，范围至第 ${Math.max(...selectedRounds)} 轮`}
              </p>
              {summaryError && (
                <p className="text-sm text-red-500 dark:text-red-400 mb-2">{summaryError}</p>
              )}
              {!networkConfig ? (
                <p className="text-sm text-amber-500 dark:text-amber-400">请先在存档设定中配置API密钥和端点</p>
              ) : (
                <button
                  onClick={handleOneClickSummary}
                  disabled={isSummarizing || selectedRounds.size === 0}
                  className="w-full px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSummarizing ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      AI总结中...
                    </span>
                  ) : '一键总结'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors min-h-[44px]"
          >
            重置压缩
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors min-h-[44px] ${
              showPromptEditor
                ? 'bg-accent text-white'
                : 'text-text-secondary dark:text-text-secondary-dark hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            总结提示词
          </button>
        </div>
      </div>
    </div>

    {showPromptEditor && (
      <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center" onClick={() => setShowPromptEditor(false)}>
        <div
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl max-h-[80vh] flex flex-col p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold mb-2">总结提示词</h3>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-3">
            修改下面提示词可自定义 AI 总结记忆的方式。默认提示词已预填。
          </p>
          <ResizableTextarea
            value={compressionPrompt}
            onChange={(e) => setCompressionPrompt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono"
            rows={12}
            minHeight={200}
          />
          <button
            onClick={async () => {
              try {
                const updated = await updateSave(save.id, { compressionPrompt });
                if (updated) {
                  setLiveSave(updated);
                  onSaveUpdate?.(updated);
                }
              } catch (e) {
                console.error('保存提示词失败:', e);
              }
              setShowPromptEditor(false);
            }}
            className="mt-3 self-end px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity min-h-[44px]"
          >
            完成
          </button>
        </div>
      </div>
    )}

    {showResetConfirm && (
      <ConfirmDialog
        message="确定要清空所有摘要和压缩记录吗？此操作不可撤销。"
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
      />
    )}
    </>
  );
}
