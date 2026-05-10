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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-[96vw] h-[96vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
              编辑消息
            </h3>
            <p className="text-base text-text-secondary dark:text-text-secondary-dark mt-0.5">
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

        <div className="flex-1 overflow-auto p-6 flex flex-col">
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full flex-1 px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-text-primary dark:text-text-primary-dark text-lg resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent font-serif leading-relaxed"
            placeholder="输入消息内容..."
          />
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-lg font-medium text-text-secondary dark:text-text-secondary-dark hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !editText.trim()}
            className="px-6 py-2 text-lg font-medium text-white bg-accent hover:bg-accent/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
