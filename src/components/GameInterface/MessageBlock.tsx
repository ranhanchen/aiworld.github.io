import type { Message, MessageSegment } from '@/types/message';

interface MessageBlockProps {
  message: Message;
  onLongPress?: (message: Message) => void;
}

export default function MessageBlock({ message, onLongPress }: MessageBlockProps) {
  const isUser = message.role === 'user';

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onLongPress?.(message);
  };

  return (
    <div
      className={`flex mb-4 animate-slide-up ${isUser ? 'justify-end' : 'justify-start'}`}
      onContextMenu={handleContextMenu}
      data-message-id={message.id}
      data-round-index={message.roundIndex}
    >
      {isUser ? (
        <div className="bg-accent dark:bg-accent-dark text-white px-4 py-2.5 rounded-2xl rounded-br-md shadow-sm max-w-full block">
          <p className="text-base whitespace-pre-wrap break-words">{message.rawText}</p>
        </div>
      ) : (
        <div className="w-full">
          {message.isCompressedAnchor && (
            <div className="flex items-center gap-1 mb-1 ml-1">
              <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
            </svg>
            <span className="text-xs text-amber-500 font-medium">记忆锚点</span>
            </div>
          )}

          <div className="bg-panel dark:bg-panel-dark rounded-2xl rounded-bl-md shadow-sm px-4 py-3 border border-gray-100 dark:border-gray-700 text-base">
            {message.status === 'pending' && (
              <div className="flex items-center gap-2 text-text-secondary dark:text-text-secondary-dark">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                <span className="text-base">思考中...</span>
              </div>
            )}

            {message.status === 'streaming' && message.segments.length === 0 && (
              <div className="flex items-center gap-2 text-text-secondary dark:text-text-secondary-dark">
                <span className="text-base">生成中...</span>
              </div>
            )}

            {message.segments.length > 0 && (
              <div className="space-y-2">
                {message.segments.map((segment, idx) => (
                  <SegmentRenderer key={`${message.id}-seg-${idx}`} segment={segment} />
                ))}
              </div>
            )}

            {message.status === 'completed' && message.segments.length === 0 && message.rawText && (
              <p className="text-base whitespace-pre-wrap break-words text-text-primary dark:text-text-primary-dark">
                {message.rawText}
              </p>
            )}

            {message.status === 'error' && (
              <div className="flex items-center gap-2 text-red-500 text-base">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>AI响应生成失败，请检查API配置或重试</span>
              </div>
            )}

            {message.status === 'streaming' && message.segments.length > 0 && (
              <span className="inline-block w-2 h-4 bg-accent ml-0.5 animate-pulse rounded-sm" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentRenderer({ segment }: { segment: MessageSegment }) {
  switch (segment.type) {
    case 'scene':
      return (
        <p className="text-base text-text-secondary dark:text-text-secondary-dark text-center leading-relaxed my-2 font-sans">
          {segment.content}
        </p>
      );

    case 'dialogue': {
      const isThirdParty = (segment.speaker || '').includes('公告') || (segment.speaker || '').includes('系统') || (segment.speaker || '').includes('旁白');
      const isTeam = (segment.speaker || '').includes('队伍组成');
      if (isThirdParty) {
        return (
          <div className="bg-amber-100 dark:bg-amber-900/30 rounded-xl px-4 py-2.5 shadow-sm border border-amber-300 dark:border-amber-600 max-w-[90%] mx-auto text-center">
            <span className="text-base font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              {segment.speaker || '未知'}
            </span>
            <p className="text-base text-amber-800 dark:text-amber-200 leading-relaxed mt-0.5 font-serif">
              {segment.content}
            </p>
          </div>
        );
      }
      if (isTeam) {
        return (
          <div className="bg-white dark:bg-gray-700/50 rounded-xl px-4 py-2.5 shadow-sm border border-gray-100 dark:border-gray-600 max-w-[90%] mx-auto text-center">
            <span className="text-base font-bold text-accent dark:text-accent-dark uppercase tracking-wider">
              {segment.speaker || '未知'}
            </span>
            <p className="text-base text-text-primary dark:text-text-primary-dark leading-relaxed mt-0.5 font-serif">
              {segment.content}
            </p>
          </div>
        );
      }
      return (
        <div className="block">
          <div className="bg-white dark:bg-gray-700/50 rounded-xl px-3 py-2.5 shadow-sm border border-gray-100 dark:border-gray-600 max-w-[90%] inline-block">
            <span className="text-base font-bold text-accent dark:text-accent-dark uppercase tracking-wider">
              {segment.speaker || '未知'}
            </span>
            <p className="text-base text-text-primary dark:text-text-primary-dark leading-relaxed mt-0.5 font-serif">
              {segment.content}
            </p>
          </div>
        </div>
      );
    }

    case 'action':
      return (
        <p className="text-base text-text-secondary dark:text-text-secondary-dark leading-relaxed">
          * {segment.content}
        </p>
      );

    case 'system':
      return (
        <div className="border-2 border-amber-400 dark:border-amber-600 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-center">
          <p className="text-base font-bold text-amber-600 dark:text-amber-400 leading-relaxed">
            {segment.content}
          </p>
        </div>
      );
  }
}
