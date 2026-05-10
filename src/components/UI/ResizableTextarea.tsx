import { useState, useRef, type TextareaHTMLAttributes } from 'react';

interface ResizableTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number;
}

export default function ResizableTextarea({ minHeight = 100, className = '', style, ...props }: ResizableTextareaProps) {
  const [height, setHeight] = useState(() => {
    if (props.rows) return props.rows * 22 + 24;
    return 150;
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    resizeRef.current = { startY, startH };

    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const newH = Math.max(minHeight, resizeRef.current.startH + (e.clientY - resizeRef.current.startY));
      setHeight(newH);
    };

    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        {...props}
        className={`${className} resize-none`.trim()}
        style={{ height, minHeight: `${minHeight}px`, ...style }}
      />
      {!isTouchDevice && (
        <div
          className="absolute bottom-0 right-0 w-1/3 h-6 cursor-ns-resize flex items-center justify-center
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
      )}
    </div>
  );
}
