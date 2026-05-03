import type { GameConfig } from '@/types/config';
import { ensureNetworkConfig } from '@/types/config';
import { DEFAULT_GAME_CONFIG } from '@/config/constants';

export function migrateGameConfig(raw: unknown): GameConfig {
  const base = typeof raw === 'object' && raw !== null
    ? (raw as Partial<GameConfig>)
    : {};

  let oldAiTone: string | undefined;
  if (typeof base.world === 'object' && base.world !== null && 'aiTone' in base.world) {
    oldAiTone = (base.world as any).aiTone;
  }

  const network = ensureNetworkConfig(base.network);
  if (network.apis.length > 0 && !network.selectedId) {
    network.selectedId = network.apis[0].id;
  }

  const result: GameConfig = {
    ...DEFAULT_GAME_CONFIG,
    ...base,
    network,
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
    'apis数量': result.network.apis.length,
    'selectedId': result.network.selectedId,
  });

  return result;
}
