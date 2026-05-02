import { useEffect, useRef } from 'react';
import type { Message } from '@/types/message';

interface ContextMenuProps {
  message: Message;
  onAction: (action: string) => void;
  onClose: () => void;
}

export default function ContextMenu({ message, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const isAiMessage = message.role === 'ai';

  const menuItems: Array<{ id: string; label: string; icon: string; show: boolean; danger?: boolean }> = [
    { id: 'copy', label: '复制文本', icon: '📋', show: true },
    { id: 'edit', label: '编辑消息', icon: '✏️', show: true },
    { id: 'delete', label: '删除消息', icon: '🗑️', show: true, danger: true },
    { id: 'regenerate', label: '重新生成', icon: '🔄', show: isAiMessage },
    { id: 'rewrite_longer', label: '详细重写', icon: '📝', show: isAiMessage },
    { id: 'rewrite_shorter', label: '简略重写', icon: '✂️', show: isAiMessage },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div
        ref={menuRef}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-64 overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">
            {message.role === 'user' ? '用户消息' : 'AI消息'} · 第{message.roundIndex}回合
          </p>
        </div>
        <div className="py-1">
          {menuItems
            .filter((item) => item.show)
            .map((item) => (
              <button
                key={item.id}
                onClick={() => onAction(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-[44px] ${
                  item.danger
                    ? 'text-red-500 hover:text-red-600'
                    : 'text-text-primary dark:text-text-primary-dark'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
