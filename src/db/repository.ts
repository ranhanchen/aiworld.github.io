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
import { STORE_SAVES, STORE_MESSAGES } from '@/config/constants';
import { migrateGameConfig } from '@/utils/configMigration';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeStructuredClone<T>(obj: T): T {
  try {
    return structuredClone(obj);
  } catch {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      console.warn('[repository] structuredClone 和 JSON 序列化均失败，返回原对象');
      return obj;
    }
  }
}

function migrateSave(save: Save): Save {
  const migrated = safeStructuredClone(save);
  if (migrated.metadata?.configSnapshot) {
    try {
      migrated.metadata.configSnapshot = migrateGameConfig(migrated.metadata.configSnapshot);
    } catch (e) {
      console.error('[repository] migrateSave 迁移失败，保留原配置:', e);
    }
  }
  return migrated;
}

function saveToLocalBackup(save: Save): void {
  try {
    localStorage.setItem(`save_backup_${save.id}`, JSON.stringify(save));
  } catch {}
}

function loadFromLocalBackup(saveId: string): Save | null {
  try {
    const raw = localStorage.getItem(`save_backup_${saveId}`);
    if (raw) {
      return JSON.parse(raw) as Save;
    }
  } catch {}
  return null;
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
    compressionPrompt: '',
    createdAt: now,
    updatedAt: now,
  };

  if (save.metadata.configSnapshot) {
    try {
      save.metadata.configSnapshot = migrateGameConfig(save.metadata.configSnapshot);
    } catch (e) {
      console.error('[repository] createSave 迁移失败:', e);
    }
  }

  try {
    await putToStore(STORE_SAVES, save);
    saveToLocalBackup(save);
  } catch (e) {
    console.error('[repository] createSave 写入DB失败:', e);
    saveToLocalBackup(save);
  }

  return save;
}

export async function getSave(id: string): Promise<Save | undefined> {
  try {
    const raw = await getFromStore<Save>(STORE_SAVES, id);
    if (raw) {
      const migrated = migrateSave(raw);
      saveToLocalBackup(migrated);
      return migrated;
    }
  } catch (e) {
    console.error('[repository] getSave DB读取失败，尝试localStorage备份:', e);
    const backup = loadFromLocalBackup(id);
    if (backup) {
      console.log('[repository] 从localStorage备份恢复存档');
      return backup;
    }
  }
  return undefined;
}

export async function updateSave(id: string, dto: SaveUpdateDTO): Promise<Save | undefined> {
  let existing: Save | undefined;
  try {
    existing = await getSave(id);
  } catch (e) {
    console.error('[repository] updateSave 读取现有存档失败:', e);
    existing = loadFromLocalBackup(id) || undefined;
  }

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
    compressionPrompt: dto.compressionPrompt ?? existing.compressionPrompt,
    updatedAt: Date.now(),
  };

  if (updated.metadata.configSnapshot) {
    try {
      updated.metadata.configSnapshot = migrateGameConfig(updated.metadata.configSnapshot);
    } catch (e) {
      console.error('[repository] updateSave 迁移失败:', e);
    }
  }

  try {
    await putToStore(STORE_SAVES, updated);
    saveToLocalBackup(updated);
  } catch (e) {
    console.error('[repository] updateSave 写入DB失败:', e);
    saveToLocalBackup(updated);
  }

  return updated;
}

export async function deleteSave(id: string): Promise<void> {
  try {
    const messages = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', id);
    for (const msg of messages) {
      try {
        await deleteFromStore(STORE_MESSAGES, msg.id);
      } catch (e) {
        console.warn('[repository] deleteSave 删除消息失败:', msg.id, e);
      }
    }
  } catch (e) {
    console.warn('[repository] deleteSave 获取消息列表失败:', e);
  }

  try {
    await deleteFromStore(STORE_SAVES, id);
  } catch (e) {
    console.error('[repository] deleteSave 删除存档失败:', e);
    throw e;
  }

  try {
    localStorage.removeItem(`save_backup_${id}`);
  } catch {}
}

export async function getAllSaves(): Promise<Save[]> {
  try {
    const saves = await getAllFromStore<Save>(STORE_SAVES);
    return saves.map(migrateSave).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.error('[repository] getAllSaves DB读取失败:', e);
    return [];
  }
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

  try {
    await putToStore(STORE_MESSAGES, message);
  } catch (e) {
    console.error('[repository] createMessage 写入DB失败:', e);
  }

  return message;
}

export async function getMessage(id: string): Promise<Message | undefined> {
  try {
    return await getFromStore<Message>(STORE_MESSAGES, id);
  } catch (e) {
    console.error('[repository] getMessage 读取失败:', e);
    return undefined;
  }
}

export async function updateMessage(id: string, dto: MessageUpdateDTO): Promise<Message | undefined> {
  let existing: Message | undefined;
  try {
    existing = await getMessage(id);
  } catch (e) {
    console.error('[repository] updateMessage 读取现有消息失败:', e);
    return undefined;
  }

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

  try {
    await putToStore(STORE_MESSAGES, updated);
  } catch (e) {
    console.error('[repository] updateMessage 写入DB失败:', e);
  }

  return updated;
}

export async function deleteMessage(id: string): Promise<void> {
  try {
    await deleteFromStore(STORE_MESSAGES, id);
  } catch (e) {
    console.error('[repository] deleteMessage 删除失败:', e);
  }
}

export async function getMessagesBySaveId(
  saveId: string,
  limit?: number,
  offset?: number,
): Promise<Message[]> {
  try {
    console.log('[repository] getMessagesBySaveId 开始执行:', { saveId, limit, offset });
    const all = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', saveId);
    console.log('[repository] getMessagesBySaveId getAllFromIndex 结果数量:', all.length, { firstMessage: all[0] ? all[0].id : '无', lastMessage: all[all.length - 1] ? all[all.length - 1].id : '无' });
    const sorted = all.sort((a, b) => a.roundIndex - b.roundIndex);
    console.log('[repository] getMessagesBySaveId 排序后结果数量:', sorted.length, { sortedMessages: sorted.map(m => ({ id: m.id, saveId: m.saveId, roundIndex: m.roundIndex })) });

    if (offset !== undefined) {
      if (limit !== undefined) {
        const result = sorted.slice(offset, offset + limit);
        console.log('[repository] getMessagesBySaveId 带offset+limit的返回结果数量:', result.length);
        return result;
      }
      const result = sorted.slice(offset);
      console.log('[repository] getMessagesBySaveId 带offset的返回结果数量:', result.length);
      return result;
    }

    if (limit !== undefined) {
      const result = sorted.slice(-limit);
      console.log('[repository] getMessagesBySaveId 带limit的返回结果数量:', result.length);
      return result;
    }

    console.log('[repository] getMessagesBySaveId 完整返回结果数量:', sorted.length);
    return sorted;
  } catch (e) {
    console.error('[repository] getMessagesBySaveId 读取失败:', e);
    return [];
  }
}

export async function getMessagesByRoundRange(
  saveId: string,
  startRound: number,
  endRound: number,
): Promise<Message[]> {
  try {
    const all = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', saveId);
    return all
      .sort((a, b) => a.roundIndex - b.roundIndex)
      .filter((m) => m.roundIndex >= startRound && m.roundIndex <= endRound);
  } catch (e) {
    console.error('[repository] getMessagesByRoundRange 读取失败:', e);
    return [];
  }
}

export async function getMessageCountForSave(saveId: string): Promise<number> {
  try {
    const messages = await getAllFromIndex<Message>(STORE_MESSAGES, 'saveId', saveId);
    return messages.length;
  } catch (e) {
    console.error('[repository] getMessageCountForSave 读取失败:', e);
    return 0;
  }
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
    try {
      const save = await getSave(id);
      if (save) {
        saves.push(save);
        const messages = await getMessagesBySaveId(id);
        allMessages.push(...messages);
      }
    } catch (e) {
      console.error('[repository] exportSaves 导出存档失败:', id, e);
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

  console.log('[repository] importSaves 开始执行');
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { imported: 0, skipped: 0, errors: ['JSON解析失败：文件格式不正确'] };
  }

  const parsed = data as Record<string, unknown>;
  console.log('[repository] importSaves JSON解析完成', { 
    hasSaves: !!parsed.saves, 
    hasMessages: !!parsed.messages, 
    version: parsed.version 
  });

  if (!parsed || typeof parsed !== 'object') {
    return { imported: 0, skipped: 0, errors: ['数据格式无效'] };
  }

  if (parsed.version !== 1) {
    errors.push(`不支持的导出版本：${String(parsed.version)}`);
    return { imported: 0, skipped: 0, errors };
  }

  const saves = parsed.saves as Save[] | undefined;
  const messages = parsed.messages as Message[] | undefined;
  console.log('[repository] importSaves 解析后数据', {
    savesCount: Array.isArray(saves) ? saves.length : 0, 
    messagesCount: Array.isArray(messages) ? messages.length : 0,
    saves: Array.isArray(saves) ? saves.map(s => ({ id: s.id, roundCount: s.metadata?.roundCount })) : [],
    messages: Array.isArray(messages) ? messages.slice(0, 5).map(m => ({ id: m.id, saveId: m.saveId, roundIndex: m.roundIndex })) : []
  });

  if (!Array.isArray(saves) || saves.length === 0) {
    return { imported: 0, skipped: 0, errors: ['存档数据为空或格式无效'] };
  }

  let imported = 0;
  let skipped = 0;

  for (const save of saves) {
    console.log('[repository] importSaves 开始处理存档:', { id: save.id, metadata: !!save.metadata });
    if (!save.id || !save.metadata) {
      skipped++;
      errors.push(`跳过无效存档：缺少必要字段`);
      continue;
    }

    let migratedSave: Save;
    try {
      migratedSave = migrateSave(save);
    } catch (e) {
      skipped++;
      errors.push(`存档 ${save.id} 迁移失败，已跳过`);
      console.error('[repository] importSaves 迁移失败:', e);
      continue;
    }

    const oldSaveId = migratedSave.id;
    console.log('[repository] importSaves 存档迁移完成', { oldSaveId, migratedSave: migratedSave.id });

    try {
      const existing = await getSave(migratedSave.id);
      if (existing) {
        migratedSave.id = generateId();
        console.log('[repository] importSaves 存档ID已存在，生成新ID', { newId: migratedSave.id });
      }
    } catch (e) {
      console.warn('[repository] importSaves 检查存档存在性失败:', e);
    }

    try {
      migratedSave.updatedAt = Date.now();
      await putToStore(STORE_SAVES, migratedSave);
      saveToLocalBackup(migratedSave);
      imported++;
      console.log('[repository] importSaves 存档写入成功', { id: migratedSave.id });
    } catch (e) {
      skipped++;
      errors.push(`存档 ${migratedSave.id} 写入失败`);
      console.error('[repository] importSaves 写入存档失败:', e);
      continue;
    }

    if (Array.isArray(messages)) {
      console.log('[repository] importSaves 开始处理消息');
      const saveMessages = (messages as Message[]).filter(
        (m) => m.saveId === oldSaveId && m.id && typeof m.roundIndex === 'number',
      );
      console.log('[repository] importSaves 筛选后消息数量:', saveMessages.length, {
        oldSaveId,
        allMessagesSaveIds: (messages as Message[]).slice(0, 5).map(m => m.saveId)
      });

      if (saveMessages.length > 0) {
        const messagesToImport = saveMessages.map(m => ({
          ...m,
          id: generateId(),
          saveId: migratedSave.id,
          createdAt: m.createdAt || Date.now(),
          updatedAt: m.updatedAt || Date.now(),
        }));
        console.log('[repository] importSaves 准备导入的消息:', messagesToImport.slice(0, 5).map(m => ({ id: m.id, newSaveId: m.saveId })));

        try {
          await batchPut(STORE_MESSAGES, messagesToImport);
          console.log('[repository] importSaves 消息批量写入完成');
        } catch (e) {
          console.error('[repository] importSaves 批量写入消息失败，尝试逐条写入:', e);
          for (const msg of messagesToImport) {
            try {
              await putToStore(STORE_MESSAGES, msg);
            } catch (e2) {
              console.warn('[repository] importSaves 单条消息写入失败:', msg.id, e2);
            }
          }
        }
      }
    }
  }

  console.log('[repository] importSaves 导入完成', { imported, skipped, errors });
  return { imported, skipped, errors };
}

export async function diagnoseDatabase(): Promise<void> {
  console.log('========== 数据库诊断开始 ==========');

  try {
    const allSaves = await getAllFromStore<Save>(STORE_SAVES);
    console.log('[诊断] 存档总数:', allSaves.length);
    for (const save of allSaves) {
      console.log('[诊断] 存档:', { id: save.id, title: save.metadata.title, roundCount: save.metadata.roundCount });
    }
  } catch (e) {
    console.error('[诊断] 读取存档失败:', e);
  }

  try {
    const allMessages = await getAllFromStore<Message>(STORE_MESSAGES);
    console.log('[诊断] 消息总数:', allMessages.length);
    console.log('[诊断] 所有消息的saveId统计:');
    const saveIdCounts: Record<string, number> = {};
    for (const msg of allMessages) {
      saveIdCounts[msg.saveId] = (saveIdCounts[msg.saveId] || 0) + 1;
    }
    console.table(saveIdCounts);
    console.log('[诊断] 前10条消息详情:', allMessages.slice(0, 10).map(m => ({ id: m.id, saveId: m.saveId, roundIndex: m.roundIndex, role: m.role })));
  } catch (e) {
    console.error('[诊断] 读取消息失败:', e);
  }

  console.log('========== 数据库诊断结束 ==========');
}
