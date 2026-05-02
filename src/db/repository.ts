import type { Message, MessageCreateDTO, MessageUpdateDTO } from '@/types/message';
import type { Save, SaveCreateDTO, SaveUpdateDTO } from '@/types/save';
import {
  putToStore,
  getFromStore,
  deleteFromStore,
  getAllFromStore,
  getAllFromIndex,
  batchPut,
} from '@/db/database';
import {
  STORE_SAVES,
  STORE_MESSAGES,
} from '@/config/constants';
import { migrateGameConfig } from '@/utils/configMigration';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function migrateSave(save: Save): Save {
  const migrated = structuredClone(save);
  console.log('[repository] migrateSave 输入:', {
    id: migrated.id,
    'configSnapshot存在': !!migrated.metadata?.configSnapshot,
    'configSnapshot.network': JSON.stringify(migrated.metadata?.configSnapshot?.network),
  });
  if (migrated.metadata?.configSnapshot) {
    migrated.metadata.configSnapshot = migrateGameConfig(migrated.metadata.configSnapshot);
  }
  console.log('[repository] migrateSave 输出:', {
    'configSnapshot.network': JSON.stringify(migrated.metadata?.configSnapshot?.network),
  });
  return migrated;
}

export async function createSave(dto: SaveCreateDTO): Promise<Save> {
  const id = generateId();
  const now = Date.now();

  const save: Save = {
    id,
    metadata: {
      ...dto.metadata,
      roundCount: 0,
      lastPlayedAt: now,
      createdAt: now,
    },
    currentSummary: dto.currentSummary || '',
    lastCompressedRound: 0,
    createdAt: now,
    updatedAt: now,
  };

  // 在保存前确保 configSnapshot 已迁移
  if (save.metadata.configSnapshot) {
    save.metadata.configSnapshot = migrateGameConfig(save.metadata.configSnapshot);
  }

  await putToStore(STORE_SAVES, save);
  return save;
}

export async function getSave(id: string): Promise<Save | undefined> {
  const raw = await getFromStore<Save>(STORE_SAVES, id);
  return raw ? migrateSave(raw) : undefined;
}

export async function updateSave(id: string, dto: SaveUpdateDTO): Promise<Save | undefined> {
  const existing = await getSave(id);
  if (!existing) {
    return undefined;
  }

  const updated: Save = {
    ...existing,
    metadata: dto.metadata
      ? { ...existing.metadata, ...dto.metadata }
      : existing.metadata,
    currentSummary: dto.currentSummary ?? existing.currentSummary,
    lastCompressedRound: dto.lastCompressedRound ?? existing.lastCompressedRound,
    updatedAt: Date.now(),
  };

  // 确保 configSnapshot 在保存前已迁移
  if (updated.metadata.configSnapshot) {
    updated.metadata.configSnapshot = migrateGameConfig(updated.metadata.configSnapshot);
  }

  await putToStore(STORE_SAVES, updated);
  return updated;
}

export async function deleteSave(id: string): Promise<void> {
  const messages = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', id);
  for (const msg of messages) {
    await deleteFromStore(STORE_MESSAGES, msg.id);
  }
  await deleteFromStore(STORE_SAVES, id);
}

export async function getAllSaves(): Promise<Save[]> {
  const saves = await getAllFromStore<Save>(STORE_SAVES);
  return saves.map(migrateSave).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getLatestSave(): Promise<Save | undefined> {
  const saves = await getAllSaves();
  return saves.length > 0 ? saves[0] : undefined;
}

export async function createMessage(dto: MessageCreateDTO): Promise<Message> {
  const id = generateId();
  const now = Date.now();

  const message: Message = {
    id,
    saveId: dto.saveId,
    roundIndex: dto.roundIndex,
    role: dto.role,
    segments: dto.segments || [],
    rawText: dto.rawText,
    status: dto.status || 'pending',
    createdAt: now,
    updatedAt: now,
    isCompressedAnchor: false,
  };

  console.log('[repository] createMessage 保存消息:', {
    id: message.id,
    saveId: message.saveId,
    roundIndex: message.roundIndex,
    role: message.role,
    rawText: message.rawText.substring(0, 30),
  });

  await putToStore(STORE_MESSAGES, message);
  return message;
}

export async function getMessage(id: string): Promise<Message | undefined> {
  return getFromStore<Message>(STORE_MESSAGES, id);
}

export async function updateMessage(id: string, dto: MessageUpdateDTO): Promise<Message | undefined> {
  const existing = await getMessage(id);
  if (!existing) {
    return undefined;
  }

  const updated: Message = {
    ...existing,
    segments: dto.segments ?? existing.segments,
    rawText: dto.rawText ?? existing.rawText,
    status: dto.status ?? existing.status,
    isCompressedAnchor: dto.isCompressedAnchor ?? existing.isCompressedAnchor,
    updatedAt: Date.now(),
  };

  await putToStore(STORE_MESSAGES, updated);
  return updated;
}

export async function deleteMessage(id: string): Promise<void> {
  await deleteFromStore(STORE_MESSAGES, id);
}

export async function getMessagesBySaveId(
  saveId: string,
  limit?: number,
  offset?: number,
): Promise<Message[]> {
  // 使用 bound 范围查询精确匹配 saveId，createdAt 范围为 [0, Infinity]
  const range = IDBKeyRange.bound([saveId, 0], [saveId, Infinity]);
  const all = await getAllFromIndex<Message>(
    STORE_MESSAGES,
    'saveId_createdAt',
    range,
  );

  console.log('[repository] getMessagesBySaveId 查询结果:', {
    saveId,
    查询到的消息数: all.length,
    消息IDs: all.map(m => m.id),
    消息详情: all.map(m => ({
      id: m.id,
      saveId: m.saveId,
      role: m.role,
      roundIndex: m.roundIndex,
      rawText: m.rawText,
      createdAt: m.createdAt,
    })),
  });

  const sorted = all.sort((a, b) => a.roundIndex - b.roundIndex);

  if (offset !== undefined) {
    const start = offset;
    const end = limit !== undefined ? start + limit : undefined;
    return sorted.slice(start, end);
  }

  if (limit !== undefined) {
    return sorted.slice(-limit);
  }

  return sorted;
}

export async function getMessagesByRoundRange(
  saveId: string,
  startRound: number,
  endRound: number,
): Promise<Message[]> {
  async function getAllMessagesForSave(saveId: string): Promise<Message[]> {
    const all = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', saveId);
    return all.sort((a, b) => a.roundIndex - b.roundIndex);
  }

  const all = await getAllMessagesForSave(saveId);
  return all.filter(
    (m) => m.roundIndex >= startRound && m.roundIndex <= endRound,
  );
}

export async function getMessageCountForSave(saveId: string): Promise<number> {
  const messages = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', saveId);
  return messages.length;
}

export async function markMessageAsAnchor(
  messageId: string,
  isAnchor: boolean,
): Promise<Message | undefined> {
  return updateMessage(messageId, { isCompressedAnchor: isAnchor });
}

export async function exportSaves(saveIds: string[]): Promise<string> {
  const saves: Save[] = [];
  const allMessages: Message[] = [];

  for (const id of saveIds) {
    const save = await getSave(id);
    if (save) {
      saves.push(save);
      const messages = await getMessagesBySaveId(id);
      allMessages.push(...messages);
    }
  }

  const exportData = {
    version: 1,
    exportedAt: Date.now(),
    saves,
    messages: allMessages,
  };

  return JSON.stringify(exportData, null, 2);
}

export async function importSaves(jsonString: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];

  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { imported: 0, skipped: 0, errors: ['JSON解析失败：文件格式不正确'] };
  }

  const parsed = data as Record<string, unknown>;

  if (!parsed || typeof parsed !== 'object') {
    return { imported: 0, skipped: 0, errors: ['数据格式无效'] };
  }

  if (parsed.version !== 1) {
    errors.push(`不支持的导出版本：${String(parsed.version)}`);
    return { imported: 0, skipped: 0, errors };
  }

  const saves = parsed.saves as Save[] | undefined;
  const messages = parsed.messages as Message[] | undefined;

  if (!Array.isArray(saves) || saves.length === 0) {
    return { imported: 0, skipped: 0, errors: ['存档数据为空或格式无效'] };
  }

  let imported = 0;
  let skipped = 0;

  for (const save of saves) {
    if (!save.id || !save.metadata) {
      skipped++;
      errors.push(`跳过无效存档：缺少必要字段`);
      continue;
    }

    // 迁移导入的存档
    const migratedSave = migrateSave(save);
    let oldSaveId = migratedSave.id;

    const existing = await getSave(migratedSave.id);
    if (existing) {
      oldSaveId = migratedSave.id;
      migratedSave.id = generateId();
    }

    await putToStore(STORE_SAVES, migratedSave);
    imported++;

    // 更新该存档对应的消息的 saveId
    if (Array.isArray(messages)) {
      const validMessages = messages.filter(
        (m) => m.id && m.saveId && typeof m.roundIndex === 'number',
      );
      const messagesToImport = validMessages.map(m => ({
        ...m,
        saveId: migratedSave.id, // 更新为新的存档 ID
      }));
      if (messagesToImport.length > 0) {
        await batchPut(STORE_MESSAGES, messagesToImport);
      }
    }
  }

  return { imported, skipped, errors };
}
