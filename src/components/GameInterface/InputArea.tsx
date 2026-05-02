import { useState, useRef, useCallback, useEffect } from 'react';
import { KEYBOARD_SHORTCUTS } from '@/config/constants';

interface InputAreaProps {
  onSend: (text: string) => void;
  onContinue: () => void;
  disabled?: boolean;
}

export default function InputArea({ onSend, onContinue, disabled }: InputAreaProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const maxHeight = 150;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的行动或对话..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50 min-h-[44px]"
        />
        <button
          onClick={onContinue}
          disabled={disabled}
          className="shrink-0 px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity min-h-[44px]"
          title="让AI继续推动剧情"
        >
          继续
        </button>
        <button
          onClick={handleSend}
          disabled={disabled || text.trim().length === 0}
          className="shrink-0 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity min-h-[44px] min-w-[44px]"
          title={KEYBOARD_SHORTCUTS.SEND}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
      <p className="text-[10px] text-text-secondary dark:text-text-secondary-dark text-center mt-1">
        {KEYBOARD_SHORTCUTS.SEND} 发送
      </p>
    </div>
  );
}
