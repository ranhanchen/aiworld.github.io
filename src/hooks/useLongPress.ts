import { useRef, useCallback } from 'react';
import { LONG_PRESS_DURATION_MS } from '@/config/constants';

interface UseLongPressOptions {
  onLongPress: (event: React.TouchEvent | React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  duration?: number;
}

interface UseLongPressReturn {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function useLongPress(options: UseLongPressOptions): UseLongPressReturn {
  const { onLongPress, onContextMenu, duration = LONG_PRESS_DURATION_MS } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventRef = useRef<React.TouchEvent | null>(null);
  const hasMovedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      hasMovedRef.current = false;
      eventRef.current = e;
      clearTimer();

      timerRef.current = setTimeout(() => {
        if (!hasMovedRef.current && eventRef.current) {
          onLongPress(eventRef.current);
        }
      }, duration);
    },
    [onLongPress, duration, clearTimer],
  );

  const onTouchEnd = useCallback(() => {
    clearTimer();
    eventRef.current = null;
  }, [clearTimer]);

  const onTouchMove = useCallback(() => {
    hasMovedRef.current = true;
  }, []);

  const onContextMenuHandler = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu(e);
      } else {
        onLongPress(e);
      }
    },
    [onLongPress, onContextMenu],
  );

  return {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onContextMenu: onContextMenuHandler,
  };
}
