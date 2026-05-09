import { useState, useEffect, useRef } from 'react';
import type { Message } from '@/types/message';

interface MessageEditorProps {
  message: Message;
  onSave: (editedText: string) => void;
  onCancel: () => void;
}

export default function MessageEditor({ message, onSave, onCancel }: MessageEditorProps) {
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editorHeight, setEditorHeight] = useState(300);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const isAiMessage = message.role === 'ai';
  const hasSegments = message.segments && message.segments.length > 0;

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  useEffect(() => {
    if (hasSegments) {
      const formattedText = message.segments!
        .map(seg => {
          if (seg.type === 'scene') return `[场景] ${seg.content}`;
          if (seg.type === 'dialogue') return `【${seg.speaker || '未知'}】${seg.content}`;
          if (seg.type === 'action') return `*${seg.content}*`;
          if (seg.type === 'system') return `[系统] ${seg.content}`;
          return seg.content;
        })
        .join('\n\n');
      setEditText(formattedText);
    } else {
      setEditText(message.rawText);
    }
  }, [hasSegments, message.segments, message.rawText]);

  const handleSave = async () => {
    if (!editText.trim()) return;

    setIsSaving(true);
    try {
      onSave(editText);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = editorHeight;
    resizeRef.current = { startY, startH };

    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const newH = Math.max(200, resizeRef.current.startH + (e.clientY - resizeRef.current.startY));
      setEditorHeight(newH);
    };

    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
  };

  const characterCount = editText.length;
  const lineCount = editText.split('\n').length;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl max-h-[90vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
              编辑消息
            </h3>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-0.5">
              {isAiMessage ? 'AI消息' : '用户消息'} · 第{message.roundIndex}回合 · 按 Ctrl+Enter 保存
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
              {isAiMessage ? '回复内容（将同步更新所有对话片段）' : '消息内容'}
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-text-primary dark:text-text-primary-dark resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent font-serif leading-relaxed"
                style={{ height: editorHeight, minHeight: '200px' }}
                placeholder="输入消息内容..."
              />
              {/* 自定义拖拽手柄 - 宽度1/3 */}
              <div
                className="absolute bottom-0 left-1/3 right-1/3 h-6 cursor-ns-resize flex items-center justify-center
                           bg-gray-200/50 dark:bg-gray-700/50 hover:bg-gray-300/50 dark:hover:bg-gray-600/50
                           rounded-b-xl select-none"
                onMouseDown={handleResizeStart}
              >
                <div className="flex gap-1">
                  <div className="w-5 h-0.5 bg-gray-400 dark:bg-gray-500 rounded" />
                  <div className="w-5 h-0.5 bg-gray-400 dark:bg-gray-500 rounded" />
                  <div className="w-5 h-0.5 bg-gray-400 dark:bg-gray-500 rounded" />
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center mt-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <span>{characterCount} 字符 · {lineCount} 行</span>
              {isAiMessage && (
                <span className="text-amber-600 dark:text-amber-400">
                  编辑将影响所有对话片段的显示
                </span>
              )}
            </div>
          </div>

          {isAiMessage && hasSegments && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                当前对话片段预览
              </label>
              <div className="space-y-2 max-h-40 overflow-auto bg-gray-50 dark:bg-gray-900 rounded-xl p-3">
                {message.segments!.map((seg, idx) => (
                  <div key={idx} className="text-xs bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700">
                    <span className="font-bold text-accent dark:text-accent-dark uppercase">
                      {seg.type === 'dialogue' ? seg.speaker || '对话' :
                       seg.type === 'scene' ? '场景' :
                       seg.type === 'action' ? '动作' :
                       seg.type === 'system' ? '系统' : seg.type}:
                    </span>
                    <span className="ml-2 text-text-primary dark:text-text-primary-dark">
                      {seg.content.length > 50 ? seg.content.substring(0, 50) + '...' : seg.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAiMessage && !hasSegments && (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    AI 回复尚未完成解析
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-300 mt-1">
                    此消息的对话片段尚未生成。编辑后的内容将在重新打开游戏时显示。
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isAiMessage && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    用户消息编辑说明
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                    编辑用户消息将触发重新生成AI回复。系统将使用编辑后的内容作为新的用户输入。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-text-secondary dark:text-text-secondary-dark hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !editText.trim()}
            className="px-6 py-2 text-sm font-medium text-white bg-accent hover:bg-accent/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                保存中...
              </>
            ) : (
              '保存'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
