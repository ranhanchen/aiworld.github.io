import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

interface VirtualListItem<T> {
  index: number;
  item: T;
  height: number;
  offset: number;
}

interface UseVirtualListOptions {
  itemHeight: number;
  overscan?: number;
  containerHeight: number;
  totalCount: number;
}

interface UseVirtualListReturn {
  visibleItems: VirtualListItem<number>[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  totalHeight: number;
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  currentScrollTop: number;
}

export function useVirtualList(options: UseVirtualListOptions): UseVirtualListReturn {
  const { itemHeight, overscan = 5, containerHeight, totalCount } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const visibleItems = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      totalCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan,
    );

    const items: VirtualListItem<number>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        item: i,
        height: itemHeight,
        offset: i * itemHeight,
      });
    }

    return items;
  }, [scrollTop, itemHeight, overscan, containerHeight, totalCount]);

  const totalHeight = totalCount * itemHeight;

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const targetScrollTop = index * itemHeight;
      container.scrollTo({
        top: targetScrollTop,
        behavior,
      });
    },
    [itemHeight],
  );

  return {
    visibleItems,
    containerRef,
    totalHeight,
    scrollToIndex,
    currentScrollTop: scrollTop,
  };
}
