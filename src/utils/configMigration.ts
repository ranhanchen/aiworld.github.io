import type { GameConfig } from '@/types/config';
import { DEFAULT_GAME_CONFIG } from '@/config/constants';

export function migrateGameConfig(raw: unknown): GameConfig {
  const base = typeof raw === 'object' && raw !== null
    ? (raw as Partial<GameConfig>)
    : {};

  console.log('[configMigration] 输入 raw.network:', {
    type: typeof raw,
    hasNetwork: !!(raw as any)?.network,
    networkJson: JSON.stringify((raw as any)?.network),
  });

  let oldAiTone: string | undefined;
  if (typeof base.world === 'object' && base.world !== null && 'aiTone' in base.world) {
    oldAiTone = (base.world as any).aiTone;
  }

  const result: GameConfig = {
    ...DEFAULT_GAME_CONFIG,
    ...base,
    network: { ...DEFAULT_GAME_CONFIG.network, ...(base.network || {}) },
    system: { ...DEFAULT_GAME_CONFIG.system, ...(base.system || {}) },
    world: {
      ...DEFAULT_GAME_CONFIG.world,
      ...(base.world || {}),
    },
    aiRestriction: {
      ...DEFAULT_GAME_CONFIG.aiRestriction,
      ...(base.aiRestriction || {}),
      aiTone: (base.aiRestriction?.aiTone || oldAiTone || DEFAULT_GAME_CONFIG.aiRestriction.aiTone),
    },
    character: {
      ...DEFAULT_GAME_CONFIG.character,
      ...(base.character || {}),
      skills: Array.isArray(base.character?.skills) ? base.character.skills : [],
    },
    winCondition: {
      ...DEFAULT_GAME_CONFIG.winCondition,
      ...(base.winCondition || {}),
      subGoals: Array.isArray(base.winCondition?.subGoals) ? base.winCondition.subGoals : [],
      failureConditions: Array.isArray(base.winCondition?.failureConditions) ? base.winCondition.failureConditions : [],
    },
  };

  console.log('[configMigration] migrateGameConfig 结果:', {
    'network.apiEndpoint': result.network.apiEndpoint?.substring(0, 40),
    'network.apiKey': result.network.apiKey ? `***${result.network.apiKey.slice(-4)}` : '(空)',
    'network.modelName': result.network.modelName,
  });

  return result;
}
