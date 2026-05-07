import type { MessageSegment } from '@/types/message';
import type { SaveMetadata } from '@/types/save';

function tryParseSingleItem(item: unknown): MessageSegment | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const record = item as Record<string, unknown>;
  const type = record.type as string | undefined;

  if (!type || !['scene', 'dialogue', 'action', 'system'].includes(type)) {
    return null;
  }

  const content = record.content;
  if (typeof content !== 'string' || !content) {
    if (typeof record.text === 'string' && record.text) {
      return { type: type as MessageSegment['type'], content: record.text };
    }
    return null;
  }

  const segment: MessageSegment = {
    type: type as MessageSegment['type'],
    content,
  };

  if (type === 'dialogue') {
    const speaker = record.speaker;
    if (typeof speaker === 'string' && speaker) {
      segment.speaker = speaker;
    } else {
      segment.speaker = '未知';
    }
  }

  return segment;
}

function extractJsonFromMarkdown(input: string): string {
  const trimmed = input.trim();

  const fencedRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let bestContent = '';
  let bestScore = -1;
  let match: RegExpExecArray | null;

  while ((match = fencedRegex.exec(trimmed)) !== null) {
    const content = match[1].trim();
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        if (parsed.length > bestScore) {
          bestScore = parsed.length;
          bestContent = content;
        }
      } else if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        if (bestScore < 1) {
          bestScore = 1;
          bestContent = content;
        }
      }
    } catch {
      // ignore malformed JSON in this block, try next
    }
  }

  if (bestScore > 0) {
    return bestContent;
  }

  const inline = trimmed.match(/`([\s\S]*?)`/);
  if (inline && inline[1]) {
    const inlineContent = inline[1].trim();
    try {
      JSON.parse(inlineContent);
      return inlineContent;
    } catch {
      // ignore
    }
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // ignore
  }

  const jsonLike = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})$/);
  if (jsonLike) {
    try {
      JSON.parse(jsonLike[1]);
      return jsonLike[1];
    } catch {
      // ignore
    }
  }

  return trimmed;
}

export function parseMessageSegments(rawText: string): {
  segments: MessageSegment[];
  isValid: boolean;
  error?: string;
} {
  if (!rawText || rawText.trim().length === 0) {
    return { segments: [], isValid: false, error: '输入文本为空' };
  }

  try {
    const jsonText = extractJsonFromMarkdown(rawText);
    const parsed: unknown = JSON.parse(jsonText);

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
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const segment = tryParseSingleItem(items[i]);
      if (segment) {
        segments.push(segment);
      } else {
        errors.push(`第${i + 1}个元素解析失败`);
      }
    }

    if (segments.length > 0) {
      return { segments, isValid: true };
    }

    return { segments: [], isValid: false, error: errors.length > 0 ? errors.join('；') : '所有元素解析失败' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { segments: [], isValid: false, error: `JSON解析失败: ${message}` };
  }
}

export function generateSaveTitle(metadata: SaveMetadata): string {
  if (metadata.title && metadata.title.trim()) {
    return metadata.title.trim();
  }
  const name = metadata.configSnapshot?.character?.name;
  const world = metadata.configSnapshot?.world?.world;
  if (name && world) {
    return `${name} - ${world.slice(0, 15)}${world.length > 15 ? '...' : ''}`;
  }
  if (name) {
    return `${name}的冒险`;
  }
  return `未命名存档`;
}
