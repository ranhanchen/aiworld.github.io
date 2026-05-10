import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/types/message';

interface ContextMenuProps {
  message: Message;
  onAction: (action: string) => void;
  onClose: () => void;
}

export default function ContextMenu({ message, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

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

  const handleCopy = async () => {
    onAction('copy');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const menuItems: Array<{ id: string; label: string; show: boolean; danger?: boolean }> = [
    { id: 'copy', label: copied ? '已复制' : '复制文本', show: true },
    { id: 'edit', label: '编辑消息', show: true },
    { id: 'resend', label: '重新发送', show: !isAiMessage },
    { id: 'delete', label: '删除消息', show: true, danger: true },
    { id: 'regenerate', label: '重新生成', show: isAiMessage },
    { id: 'rewrite_longer', label: '详细重写', show: isAiMessage },
    { id: 'rewrite_shorter', label: '简略重写', show: isAiMessage },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div
        ref={menuRef}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-64 overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
          <p className="text-base text-text-secondary dark:text-text-secondary-dark truncate">
            {message.role === 'user' ? '用户消息' : 'AI消息'} · 第{message.roundIndex}回合
          </p>
        </div>
        <div className="py-1">
          {menuItems
            .filter((item) => item.show)
            .map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'copy') {
                    handleCopy();
                  } else {
                    onAction(item.id);
                  }
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-[44px] ${
                  item.danger
                    ? 'text-red-500 hover:text-red-600'
                    : 'text-text-primary dark:text-text-primary-dark'
                }`}
              >
                <span>{item.label}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
