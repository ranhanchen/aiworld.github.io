import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Save } from '@/types/save';
import type { Message } from '@/types/message';
import { getActiveApi } from '@/types/config';
import { updateSave, getMessagesByRoundRange } from '@/db/repository';
import { createNonStreamingRequest, createCompressionPrompt } from '@/config/api';
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
  const [selectedEndRound, setSelectedEndRound] = useState(0);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [allUnsummarizedMessages, setAllUnsummarizedMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [markAsCompressed, setMarkAsCompressed] = useState(false);
  const [liveSave, setLiveSave] = useState(save);

  // 挂载时从 DB 读取最新 save 数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getSave } = await import('@/db/repository');
        const latest = await getSave(save.id);
        if (latest && !cancelled) {
          setLiveSave(latest);
          setSelectedEndRound(latest.metadata.roundCount);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [save.id]);

  const firstUnsummarizedRound = Math.max(1, (liveSave.lastCompressedRound || 0) + 1);
  const hasUnsummarizedContent = firstUnsummarizedRound <= liveSave.metadata.roundCount;

  const networkConfig = useMemo(() => {
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
  }, [save]);

  const filteredMessagesForSummary = useMemo(() => {
    if (!hasUnsummarizedContent) return [];
    return allUnsummarizedMessages.filter(
      m => m.roundIndex >= firstUnsummarizedRound && m.roundIndex <= selectedEndRound
    );
  }, [allUnsummarizedMessages, firstUnsummarizedRound, selectedEndRound, hasUnsummarizedContent]);

  useEffect(() => {
    const loadAnchor = async () => {
      if (save.lastCompressedRound <= 0) return;
      setLoadingAnchor(true);
      try {
        const anchorMessages = await getMessagesByRoundRange(
          save.id,
          save.lastCompressedRound,
          save.lastCompressedRound,
        );
        if (anchorMessages.length > 0) setAnchorMessage(anchorMessages[0]);
      } catch {
        console.error('Failed to load anchor message');
      } finally {
        setLoadingAnchor(false);
      }
    };
    loadAnchor();
  }, [save.id, liveSave.lastCompressedRound]);

  useEffect(() => {
    if (!hasUnsummarizedContent) return;
    const fetchMessages = async () => {
      setLoadingMessages(true);
      try {
        const msgs = await getMessagesByRoundRange(save.id, firstUnsummarizedRound, liveSave.metadata.roundCount);
        setAllUnsummarizedMessages(msgs);
      } catch (e) {
        console.error('获取未压缩消息失败:', e);
      } finally {
        setLoadingMessages(false);
      }
    };
    fetchMessages();
  }, [save.id, firstUnsummarizedRound, liveSave.metadata.roundCount, hasUnsummarizedContent]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSaveSummary = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updateFields: Parameters<typeof updateSave>[1] = { currentSummary: summary };
      if (markAsCompressed && selectedEndRound > (liveSave.lastCompressedRound || 0)) {
        updateFields.lastCompressedRound = selectedEndRound;
      }
      const updated = await updateSave(save.id, updateFields);
      if (updated) {
        setMessage({ type: 'success', text: '摘要保存成功' });
        setMarkAsCompressed(false);
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
  }, [liveSave, summary, markAsCompressed, selectedEndRound, onSaveUpdate]);

  const handleOneClickSummary = useCallback(async () => {
    if (!networkConfig || filteredMessagesForSummary.length === 0) return;
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const messagesText = filteredMessagesForSummary
        .map(m => (m.role === 'user' ? '【玩家】' : '【AI】') + (m.rawText || ''))
        .join('\n\n---\n\n');
      const userMsg = createCompressionPrompt(liveSave.currentSummary, messagesText);
      const { response } = createNonStreamingRequest(
        networkConfig.apiEndpoint,
        networkConfig.apiKey,
        networkConfig.modelName,
        [
          { role: 'system', content: '你是一个专业的文字冒险游戏记忆压缩引擎。请根据以下对话内容生成一段只包含所有关键信息的结构化中文摘要。保持简洁但信息完整。' },
          { role: 'user', content: userMsg },
        ],
        { temperature: 0.3, topP: 0.9 },
      );
      const result = await response;
      setSummary(result);
      setMarkAsCompressed(true);
    } catch (e) {
      setSummaryError(`AI总结失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSummarizing(false);
    }
  }, [networkConfig, filteredMessagesForSummary, save.currentSummary]);

  const handleJumpToAnchor = useCallback(() => {
    if (!anchorMessage) return;
    const selector = `[data-message-id="${anchorMessage.id}"]`;
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('animate-pulse-highlight');
      setTimeout(() => element.classList.remove('animate-pulse-highlight'), 6000);
    }
    onClose();
  }, [anchorMessage, onClose]);

  const anchorText = anchorMessage
    ? anchorMessage.rawText.length > 20 ? anchorMessage.rawText.slice(0, 20) + '…' : anchorMessage.rawText
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

          {hasUnsummarizedContent && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-4">
              <h3 className="text-base font-semibold mb-3">一键总结未压缩内容</h3>
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-3">
                未压缩范围：第 {firstUnsummarizedRound} 轮 ~ 第 {liveSave.metadata.roundCount} 轮
              </p>
              <div className="mb-3">
                <label className="text-sm font-medium block mb-1.5 text-text-primary dark:text-text-primary-dark">
                  截止回合：第 {selectedEndRound} 轮
                </label>
                <input
                  type="range"
                  min={firstUnsummarizedRound}
                  max={liveSave.metadata.roundCount}
                  value={selectedEndRound}
                  onChange={(e) => setSelectedEndRound(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark mt-1">
                  <span>第 {firstUnsummarizedRound} 轮</span>
                  <span>第 {liveSave.metadata.roundCount} 轮</span>
                </div>
              </div>
              {loadingMessages ? (
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-3">加载消息中...</p>
              ) : (
                <>
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-1">
                  共 {filteredMessagesForSummary.length} 条消息，{filteredMessagesForSummary.reduce((s, m) => s + (m.rawText || '').length, 0)} 字符
                </p>
                {filteredMessagesForSummary.length > 0 && (() => {
                  const last = filteredMessagesForSummary[filteredMessagesForSummary.length - 1];
                  const txt = (last.rawText || '').split('\n').slice(0, 2).join('\n').slice(0, 80);
                  return <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 truncate">……{txt}</p>;
                })()}
                </>
              )}
              {summaryError && (
                <p className="text-sm text-red-500 dark:text-red-400 mb-3 break-words">{summaryError}</p>
              )}
              {!networkConfig ? (
                <p className="text-sm text-amber-500 dark:text-amber-400">请先在存档设定中配置API密钥和端点</p>
              ) : (
                <button
                  onClick={handleOneClickSummary}
                  disabled={isSummarizing || filteredMessagesForSummary.length === 0}
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

          {liveSave.lastCompressedRound > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-semibold mb-2">时空锚点</h3>
              {loadingAnchor ? (
                <p className="text-xs text-text-secondary">加载锚点信息...</p>
              ) : anchorMessage ? (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                    已压缩至第 {liveSave.lastCompressedRound} 轮
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
                <p className="text-xs text-text-secondary">锚点消息已丢失或尚未创建</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
