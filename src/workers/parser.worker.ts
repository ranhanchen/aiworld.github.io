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

    if (!Array.isArray(parsed)) {
      const response: ParseResponse = {
        id,
        segments: [],
        isValid: false,
        error: '解析结果不是JSON数组',
      };
      self.postMessage(response);
      return;
    }

    if (parsed.length === 0) {
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

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i] as Record<string, unknown>;

      if (!item || typeof item !== 'object') {
        const response: ParseResponse = {
          id,
          segments: [],
          isValid: false,
          error: `第${i + 1}个元素不是有效对象`,
        };
        self.postMessage(response);
        return;
      }

      const type = item.type as string | undefined;
      if (!type || !['scene', 'dialogue', 'action', 'system'].includes(type)) {
        const response: ParseResponse = {
          id,
          segments: [],
          isValid: false,
          error: `第${i + 1}个元素的type值无效: ${String(type)}`,
        };
        self.postMessage(response);
        return;
      }

      const content = item.content as string | undefined;
      if (!content || typeof content !== 'string') {
        const response: ParseResponse = {
          id,
          segments: [],
          isValid: false,
          error: `第${i + 1}个元素缺少content字段`,
        };
        self.postMessage(response);
        return;
      }

      const segment: MessageSegment = {
        type: type as MessageSegment['type'],
        content,
      };

      if (type === 'dialogue') {
        const speaker = item.speaker as string | undefined;
        if (!speaker || typeof speaker !== 'string') {
          const response: ParseResponse = {
            id,
            segments: [],
            isValid: false,
            error: `第${i + 1}个dialogue元素缺少speaker字段`,
          };
          self.postMessage(response);
          return;
        }
        segment.speaker = speaker;
      }

      segments.push(segment);
    }

    const response: ParseResponse = { id, segments, isValid: true };
    self.postMessage(response);
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
