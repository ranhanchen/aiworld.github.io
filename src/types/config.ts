export interface NetworkConfig {
  apiEndpoint: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  topP: number;
}

export interface SystemConfig {
  language: 'zh-CN' | 'en-US';
  fontSize: 'small' | 'medium' | 'large';
  autoScroll: boolean;
  streamingDelay: number;
}

export interface WorldConfig {
  world: string;
  map: string;
  keyCharacters: string;
  customFields: Record<string, string>;
}

export interface AiRestrictionConfig {
  aiTone: string;
  aiBasePrompt: string;
  customFields: Record<string, string>;
}

export interface CharacterConfig {
  name: string;
  gender: string;
  age: string;
  background: string;
  occupation: string;
  skills: string[];
  personality: string;
  appearance: string;
  customFields: Record<string, string>;
}

export interface WinConditionConfig {
  mainGoal: string;
  subGoals: string[];
  failureConditions: string[];
  customFields: Record<string, string>;
}

export interface GameConfig {
  network: NetworkConfig;
  system: SystemConfig;
  world: WorldConfig;
  aiRestriction: AiRestrictionConfig;
  character: CharacterConfig;
  winCondition: WinConditionConfig;
}

export type ConfigTabKey = 'network' | 'system' | 'world' | 'aiRestriction' | 'character' | 'winCondition';

export interface LLMGenerateRequest {
  fieldName: string;
  context: Partial<GameConfig>;
  instruction: string;
}
