import type { GameConfig, NetworkConfig, ApiConfig, SystemConfig, WorldConfig, AiRestrictionConfig, CharacterConfig, WinConditionConfig, ConfigTabKey } from '@/types/config';

export const APP_NAME = '文字冒险 - AI Text Adventure';

export const DB_NAME = 'TextAdventureDB';
export const DB_VERSION = 1;

export const STORE_SAVES = 'saves';
export const STORE_MESSAGES = 'messages';

export const CONTINUE_STORY_PROMPT = '请继续推动后续剧情的发展';
export const CONTINUE_STORY_PROMPT_OLD = '请继续推动剧情发展';
export const HIDDEN_PROMPTS = [CONTINUE_STORY_PROMPT, CONTINUE_STORY_PROMPT_OLD];

export const MESSAGE_PAGE_SIZE = 30;

export const COMPRESSION_THRESHOLD = 100;
export const COMPRESSION_WINDOW_SIZE = 50;
export const COMPRESSION_NOTIFICATION_INTERVAL = 10;
export const CONTEXT_WINDOW_SIZE = 50;

export const DEBOUNCE_SCROLL_MS = 100;
export const LONG_PRESS_DURATION_MS = 600;
export const MIN_HIT_TARGET_PX = 44;

export const BREAKPOINT_MOBILE = 768;

export const KEYBOARD_SHORTCUTS = {
  SEND: 'Ctrl+Enter',
  CANCEL: 'Escape',
} as const;

const DEFAULT_API_ID = 'api_default';

export const DEFAULT_API_CONFIG: ApiConfig = {
  id: DEFAULT_API_ID,
  label: '默认API',
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  modelName: 'gpt-4o',
  temperature: 0.8,
  topP: 0.95,
};

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  apis: [{ ...DEFAULT_API_CONFIG }],
  selectedId: DEFAULT_API_ID,
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  language: 'zh-CN',
  fontSize: 'medium',
  autoScroll: true,
  streamingDelay: 30,
};

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  world: '',
  map: '',
  keyCharacters: '',
  customFields: {},
};

export const DEFAULT_AI_RESTRICTION_CONFIG: AiRestrictionConfig = {
  aiTone: '',
  aiBasePrompt: `你是一个专业的文字冒险游戏叙述者。请严格遵循设定来构建沉浸式的互动故事体验。玩家输入代表主角的行动和对话。你必须以JSON数组格式输出回复，每个元素包含type（scene/dialogue/action/system）和对应内容。
scene（场景） — 纯叙述/描写，交代环境、氛围、时间变化、旁白。
dialogue（对话） — 角色说话。必须带 speaker 字段标明是谁在说话。比如 {"type": "dialogue", "speaker": "酒保", "content": "要点什么？"}
action（动作） — 角色的肢体动作、神态、表情变化。紧贴在 dialogue 前后用。比如 {"type": "action", "content": "酒保擦拭着杯子，意味深长地看了你一眼"}。和 scene 的区别：action 更聚焦在"某个角色具体做了什么"，scene 更偏向"整体环境发生了什么"。
system（系统） — 游戏机制信息。
每次的输出token必须超过1500。只能多不能少。
剧情不要推动的太快，每次回复中，都应该只包括有限的事情。
每次结尾都应该是需要用户做出反应的位置，引导用户做出决断。`,
  customFields: {},
};

export const DEFAULT_CHARACTER_CONFIG: CharacterConfig = {
  name: '',
  gender: '',
  age: '',
  background: '',
  occupation: '',
  skills: [],
  personality: '',
  appearance: '',
  customFields: {},
};

export const DEFAULT_WIN_CONDITION_CONFIG: WinConditionConfig = {
  mainGoal: '',
  subGoals: [],
  failureConditions: [],
  customFields: {},
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  network: { ...DEFAULT_NETWORK_CONFIG },
  system: { ...DEFAULT_SYSTEM_CONFIG },
  world: { ...DEFAULT_WORLD_CONFIG },
  aiRestriction: { ...DEFAULT_AI_RESTRICTION_CONFIG },
  character: { ...DEFAULT_CHARACTER_CONFIG },
  winCondition: { ...DEFAULT_WIN_CONDITION_CONFIG },
};

export const CONFIG_TAB_LABELS: Record<ConfigTabKey, string> = {
  network: '网络配置',
  system: '系统核心',
  world: '世界观设定',
  aiRestriction: 'AI指令',
  character: '角色面板',
  winCondition: '获胜条件',
};

export const FONT_SIZE_CLASS_MAP: Record<SystemConfig['fontSize'], string> = {
  small: 'text-sm',
  medium: 'text-base',
  large: 'text-lg',
};

export const COVER_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#1d4ed8',
];
