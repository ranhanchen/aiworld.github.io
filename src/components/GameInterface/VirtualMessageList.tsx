import { useRef, useEffect, useCallback, useState } from 'react';
import type { Message } from '@/types/message';
import MessageBlock from '@/components/GameInterface/MessageBlock';
import { HIDDEN_PROMPTS } from '@/config/constants';

interface VirtualMessageListProps {
  messages: Message[];
  onLoadMore: () => Promise<boolean>;
  hasMore: boolean;
  onMessageLongPress: (message: Message) => void;
}

export default function VirtualMessageList({
  messages,
  onLoadMore,
  hasMore,
  onMessageLongPress,
}: VirtualMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const threshold = 100;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;
    setAutoScroll(distanceFromBottom < threshold);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom(false);
    }
  }, [messages.length, autoScroll, scrollToBottom]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      async (entries) => {
        const firstEntry = entries[0];
        if (firstEntry && firstEntry.isIntersecting && !loadingMore) {
          setLoadingMore(true);
          const previousHeight = containerRef.current?.scrollHeight || 0;

          const hasData = await onLoadMore();

          if (hasData && containerRef.current) {
            requestAnimationFrame(() => {
              const newHeight = containerRef.current!.scrollHeight;
              containerRef.current!.scrollTop = newHeight - previousHeight;
            });
          }

          setLoadingMore(false);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, loadingMore]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="w-full px-3 py-4">
        {loadingMore && (
          <div className="flex justify-center py-3">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {hasMore && !loadingMore && (
          <div ref={sentinelRef} className="h-1" />
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <svg className="w-10 h-10 text-gray-400 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              开始你的冒险吧
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (HIDDEN_PROMPTS.includes(msg.rawText)) return null;
          return (
            <MessageBlock
              key={msg.id}
              message={msg}
              onLongPress={onMessageLongPress}
            />
          );
        })}
      </div>
    </div>
  );
}
