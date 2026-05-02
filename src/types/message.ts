export interface MessageSegment {
  type: 'scene' | 'dialogue' | 'action' | 'system';
  content: string;
  speaker?: string;
}

export interface Message {
  id: string;
  saveId: string;
  roundIndex: number;
  role: 'user' | 'ai';
  segments: MessageSegment[];
  rawText: string;
  status: MessageStatus;
  createdAt: number;
  updatedAt: number;
  isCompressedAnchor?: boolean;
}

export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error';

export interface MessageCreateDTO {
  saveId: string;
  roundIndex: number;
  role: 'user' | 'ai';
  rawText: string;
  segments?: MessageSegment[];
  status?: MessageStatus;
}

export interface MessageUpdateDTO {
  segments?: MessageSegment[];
  rawText?: string;
  status?: MessageStatus;
  isCompressedAnchor?: boolean;
}
