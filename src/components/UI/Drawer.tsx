import { useEffect, useCallback, type ReactNode } from 'react';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  position?: 'left' | 'right';
}

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  position = 'right',
}: DrawerProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  const positionClass =
    position === 'right'
      ? 'right-0 translate-x-full'
      : 'left-0 -translate-x-full';

  const openTranslateClass = 'translate-x-0';

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-black/30 animate-fade-in"
        onClick={onClose}
      />
      <div
        className={`absolute top-0 bottom-0 ${positionClass} ${openTranslateClass} w-full max-w-md bg-surface dark:bg-surface-dark shadow-2xl transition-transform duration-300 ease-out`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            style={{ minWidth: `${44}px`, minHeight: `${44}px` }}
            aria-label="关闭"
            title="关闭 (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-64px)] p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
