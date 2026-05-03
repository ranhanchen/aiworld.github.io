import type { MessageSegment } from '@/types/message';
import type { SaveMetadata } from '@/types/save';

export function parseMessageSegments(rawText: string): {
  segments: MessageSegment[];
  isValid: boolean;
  error?: string;
} {
  if (!rawText || rawText.trim().length === 0) {
    return { segments: [], isValid: false, error: '输入文本为空' };
  }

  try {
    const trimmed = rawText.trim();
    const parsed: unknown = JSON.parse(trimmed);

    let items: unknown[];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      items = [parsed];
    } else {
      return { segments: [], isValid: false, error: '解析结果不是JSON数组或消息对象' };
    }

    if (items.length === 0) {
      return { segments: [], isValid: false, error: '消息数组不能为空' };
    }

    const segments: MessageSegment[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;

      if (!item || typeof item !== 'object') {
        return { segments: [], isValid: false, error: `第${i + 1}个元素不是有效对象` };
      }

      const type = item.type as string | undefined;
      if (!type || !['scene', 'dialogue', 'action', 'system'].includes(type)) {
        return { segments: [], isValid: false, error: `第${i + 1}个元素的type值无效: ${String(type)}` };
      }

      const content = item.content as string | undefined;
      if (!content || typeof content !== 'string') {
        return { segments: [], isValid: false, error: `第${i + 1}个元素缺少content字段` };
      }

      const segment: MessageSegment = {
        type: type as MessageSegment['type'],
        content,
      };

      if (type === 'dialogue') {
        const speaker = item.speaker as string | undefined;
        if (!speaker || typeof speaker !== 'string') {
          return { segments: [], isValid: false, error: `第${i + 1}个dialogue元素缺少speaker字段` };
        }
        segment.speaker = speaker;
      }

      segments.push(segment);
    }

    return { segments, isValid: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { segments: [], isValid: false, error: `JSON解析失败: ${message}` };
  }
}

export function generateSaveTitle(metadata: SaveMetadata): string {
  if (metadata.title && metadata.title.trim()) {
    return metadata.title.trim();
  }
  const name = metadata.configSnapshot.character.name;
  const world = metadata.configSnapshot.world.world;
  if (name && world) {
    return `${name} - ${world.slice(0, 15)}${world.length > 15 ? '...' : ''}`;
  }
  if (name) {
    return `${name}的冒险`;
  }
  return `未命名存档`;
}
