import type { Message, MessageSegment } from '@/types/message';

interface MessageBlockProps {
  message: Message;
}

export default function MessageBlock({ message }: MessageBlockProps) {
  if (!message || !message.segments || message.segments.length === 0) {
    return (
      <div className="flex flex-col gap-1 mb-4">
        {renderRoleChip(message.role)}
        <div className="px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-500 text-sm">
          消息片段未生成
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1 mb-4`}>
      {renderRoleChip(message.role)}
      <div className="flex flex-col gap-2 w-full">
        {message.segments.map((segment, idx) => (
          <SegmentRenderer key={`seg-${idx}`} segment={segment} />
        ))}
      </div>
    </div>
  );
}

function renderRoleChip(role: string) {
  if (role === 'user') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium self-end">
        你
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 font-medium">
      AI
    </span>
  );
}

interface SegmentRendererProps {
  segment: MessageSegment;
}

function SegmentRenderer({ segment }: SegmentRendererProps) {
  if (!segment || !segment.type) return null;

  switch (segment.type) {
    case 'scene':
      return (
        <p className="text-base text-text-secondary dark:text-text-secondary-dark text-center leading-relaxed my-2 font-sans whitespace-pre-wrap">
          {segment.content}
        </p>
      );

    case 'dialogue': {
      const speaker = segment.speaker || '未知';
      const isAnnouncement = speaker === '公告' || speaker === '系统' || speaker === '广播';

      if (isAnnouncement) {
        return (
          <div className="flex justify-center my-2">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl px-4 py-2.5 max-w-[90%]">
              <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">{speaker}</span>
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-0.5 text-center whitespace-pre-wrap">
                {segment.content}
              </p>
            </div>
          </div>
        );
      }

      return (
        <div className="flex gap-2 max-w-[70%]">
          <span className="shrink-0 text-xs font-medium text-primary dark:text-primary-dark mt-1">
            {speaker}
          </span>
          <p className="text-sm text-text-primary dark:text-text-primary-dark leading-relaxed bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm whitespace-pre-wrap">
            {segment.content}
          </p>
        </div>
      );
    }

    case 'action':
      return (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center my-1 font-sans whitespace-pre-wrap">
          * {segment.content}
        </p>
      );

    case 'system':
      return (
        <div className="flex justify-center my-2">
          <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 max-w-[90%]">
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center whitespace-pre-wrap">
              {segment.content}
            </p>
          </div>
        </div>
      );

    default:
      return (
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark whitespace-pre-wrap">
          {segment.content}
        </p>
      );
  }
}
