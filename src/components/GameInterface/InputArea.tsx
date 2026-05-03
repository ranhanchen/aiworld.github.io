import { useState, useRef, useCallback, useEffect } from 'react';
import type { ApiConfig } from '@/types/config';

interface InputAreaProps {
  onSend: (text: string) => void;
  onContinue: () => void;
  disabled?: boolean;
  apis?: ApiConfig[];
  selectedApiId?: string;
  onSelectApi?: (apiId: string) => void;
}

export default function InputArea({ onSend, onContinue, disabled, apis, selectedApiId, onSelectApi }: InputAreaProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      const maxH = 160;
      ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px';
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const showApiSelector = apis && apis.length > 1 && onSelectApi;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      {showApiSelector && (
        <div className="flex items-center gap-1 pb-2 flex-wrap">
          {apis.map((api) => (
            <button
              key={api.id}
              onClick={() => onSelectApi(api.id)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors min-h-[32px] ${
                api.id === selectedApiId
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title={`${api.label}: ${api.modelName}`}
            >
              {api.label || '未命名'}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          onClick={onContinue}
          disabled={disabled}
          className="shrink-0 h-[44px] px-4 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
          继续
        </button>
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的行动、对话或描述..."
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent transition-shadow min-h-[44px] max-h-[160px]"
            rows={1}
            disabled={disabled}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="shrink-0 h-[44px] px-5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          发送
        </button>
      </div>
    </div>
  );
}
