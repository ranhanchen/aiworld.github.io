export interface ApiConfig {
  id: string;
  label: string;
  apiEndpoint: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  topP: number;
}

export interface NetworkConfig {
  apis: ApiConfig[];
  selectedId: string;
}

export function getActiveApi(network: NetworkConfig): ApiConfig | undefined {
  if (!network.apis || network.apis.length === 0) return undefined;
  return network.apis.find((a) => a.id === network.selectedId) || network.apis[0];
}

export function ensureNetworkConfig(raw: unknown): NetworkConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { apis: [], selectedId: '' };
  }
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.apis)) {
    return {
      apis: r.apis as ApiConfig[],
      selectedId: typeof r.selectedId === 'string' ? r.selectedId : '',
    };
  }
  if (typeof r.apiEndpoint === 'string') {
    const legacy = r as unknown as { apiEndpoint: string; apiKey: string; modelName: string; temperature: number; topP: number };
    const id = 'api_' + Date.now();
    const api: ApiConfig = {
      id,
      label: legacy.modelName || '默认API',
      apiEndpoint: legacy.apiEndpoint || '',
      apiKey: legacy.apiKey || '',
      modelName: legacy.modelName || '',
      temperature: legacy.temperature ?? 0.8,
      topP: legacy.topP ?? 0.95,
    };
    return { apis: [api], selectedId: id };
  }
  return { apis: [], selectedId: '' };
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
