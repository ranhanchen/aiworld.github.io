import type { GameConfig } from '@/types/config';

export interface SaveMetadata {
  title: string;
  description: string;
  coverColor: string;
  roundCount: number;
  lastPlayedAt: number;
  createdAt: number;
  configSnapshot: GameConfig;
}

export interface Save {
  id: string;
  metadata: SaveMetadata;
  currentSummary: string;
  lastCompressedRound: number;
  compressionPrompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCreateDTO {
  metadata: Omit<SaveMetadata, 'roundCount' | 'lastPlayedAt' | 'createdAt'>;
  currentSummary?: string;
}

export interface SaveUpdateDTO {
  metadata?: Partial<SaveMetadata>;
  currentSummary?: string;
  lastCompressedRound?: number;
  compressionPrompt?: string;
}
