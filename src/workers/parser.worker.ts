import type { MessageSegment } from '@/types/message';

interface ParseRequest {
  id: string;
  rawText: string;
}

interface ParseResponse {
  id: string;
  segments: MessageSegment[];
  isValid: boolean;
  error?: string;
}

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

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, rawText } = event.data;

  try {
    if (!rawText || rawText.trim().length === 0) {
      const response: ParseResponse = {
        id,
        segments: [],
        isValid: false,
        error: '输入文本为空',
      };
      self.postMessage(response);
      return;
    }

    const trimmed = rawText.trim();
    const parsed: unknown = JSON.parse(trimmed);

    let items: unknown[];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      items = [parsed];
    } else {
      const response: ParseResponse = {
        id,
        segments: [],
        isValid: false,
        error: '解析结果不是JSON数组或消息对象',
      };
      self.postMessage(response);
      return;
    }

    if (items.length === 0) {
      const response: ParseResponse = {
        id,
        segments: [],
        isValid: false,
        error: '消息数组不能为空',
      };
      self.postMessage(response);
      return;
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
      const response: ParseResponse = { id, segments, isValid: true };
      self.postMessage(response);
    } else {
      const response: ParseResponse = {
        id,
        segments: [],
        isValid: false,
        error: errors.length > 0 ? errors.join('；') : '所有元素解析失败',
      };
      self.postMessage(response);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const response: ParseResponse = {
      id,
      segments: [],
      isValid: false,
      error: `JSON解析失败: ${message}`,
    };
    self.postMessage(response);
  }
};
