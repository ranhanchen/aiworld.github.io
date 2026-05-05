import { DB_NAME, STORE_SAVES, STORE_MESSAGES } from '@/config/constants';

const DB_VERSION = 3;

let db: IDBDatabase | null = null;
let dbReady: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (db) {
    return Promise.resolve(db);
  }

  if (dbReady) {
    return dbReady;
  }

  dbReady = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(STORE_SAVES)) {
        const savesStore = database.createObjectStore(STORE_SAVES, {
          keyPath: 'id',
        });
        savesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        savesStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_MESSAGES)) {
        const messagesStore = database.createObjectStore(STORE_MESSAGES, {
          keyPath: 'id',
        });
        messagesStore.createIndex('saveId', 'saveId', { unique: false });
        messagesStore.createIndex('roundIndex', 'roundIndex', { unique: false });
        messagesStore.createIndex('saveId_roundIndex', ['saveId', 'roundIndex'], { unique: false });
        messagesStore.createIndex('saveId_createdAt', ['saveId', 'createdAt'], { unique: false });
      } else {
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        if (transaction) {
          const messagesStore = transaction.objectStore(STORE_MESSAGES);
          if (!messagesStore.indexNames.contains('saveId_createdAt')) {
            messagesStore.createIndex('saveId_createdAt', ['saveId', 'createdAt'], { unique: false });
          }
          if (!messagesStore.indexNames.contains('saveId_roundIndex')) {
            messagesStore.createIndex('saveId_roundIndex', ['saveId', 'roundIndex'], { unique: false });
          }
        }
      }
    };

    request.onsuccess = (event: Event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      database.onclose = () => {
        db = null;
        dbReady = null;
        console.warn('[database] IndexedDB 连接已关闭，下次操作将重新连接');
      };

      database.onerror = () => {
        db = null;
        dbReady = null;
        console.error('[database] IndexedDB 连接异常');
      };

      database.onversionchange = () => {
        db = null;
        dbReady = null;
        database.close();
        console.warn('[database] IndexedDB 版本变更，连接已关闭');
      };

      db = database;
      resolve(database);
    };

    request.onerror = (event: Event) => {
      dbReady = null;
      reject(new Error(`IndexedDB open failed: ${(event.target as IDBOpenDBRequest).error?.message}`));
    };

    request.onblocked = () => {
      console.warn('[database] IndexedDB 升级被阻止，可能有其他标签页正在使用');
    };
  });

  return dbReady;
}

function invalidateConnection(): void {
  db = null;
  dbReady = null;
}

async function withRetry<T>(
  operation: (database: IDBDatabase) => Promise<T>,
  maxRetries: number = 2,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const database = await openDatabase();
      return await operation(database);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isConnectionError =
        err?.name === 'InvalidStateError' ||
        err?.name === 'TransactionInactiveError' ||
        err?.message?.includes('database was closed') ||
        err?.message?.includes('Connection is closed') ||
        err?.message?.includes('not active');

      if (isConnectionError && attempt < maxRetries) {
        console.warn(`[database] 操作失败 (尝试 ${attempt + 1}/${maxRetries})，重新连接...`, err.message);
        invalidateConnection();
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }

      break;
    }
  }

  throw lastError;
}

export async function getFromStore<T>(storeName: string, key: string): Promise<T | undefined> {
  return withRetry((database) => {
    return new Promise<T | undefined>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(new Error(`Get failed for key ${key}`));

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for get key ${key}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function putToStore<T>(storeName: string, value: T): Promise<void> {
  return withRetry((database) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          const errorMsg = (event.target as any).error?.message || 'Unknown IndexedDB error';
          console.error(`[database] putToStore failed (${storeName}):`, errorMsg, value);
          reject(new Error(`Put failed: ${errorMsg}`));
        };

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for put in ${storeName}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function deleteFromStore(storeName: string, key: string): Promise<void> {
  return withRetry((database) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(`Delete failed for key ${key}`));

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for delete key ${key}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  return withRetry((database) => {
    return new Promise<T[]>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve((request.result as T[]) || []);
        request.onerror = () => reject(new Error('Get all operation failed'));

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for getAll in ${storeName}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function getAllFromIndex<T>(
  storeName: string,
  indexName: string,
  value: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  console.log('[database] getAllFromIndex 开始执行:', { storeName, indexName, value });
  return withRetry((database) => {
    return new Promise<T[]>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.getAll(value);

        request.onsuccess = () => {
          const result = (request.result as T[]) || [];
          console.log('[database] getAllFromIndex 请求成功:', { count: result.length });
          resolve(result);
        };
        request.onerror = (event: Event) => {
          const errorMsg = `Get all from index ${indexName} failed: ${(event.target as IDBRequest).error?.message || 'Unknown error'}`;
          console.error('[database] getAllFromIndex 请求失败:', errorMsg);
          reject(new Error(errorMsg));
        };

        transaction.oncomplete = () => {};
        transaction.onerror = () => {
          const errorMsg = `Transaction failed for getAllFromIndex ${indexName}`;
          console.error('[database] getAllFromIndex 事务失败:', errorMsg);
          reject(new Error(errorMsg));
        };
      } catch (err) {
        console.error('[database] getAllFromIndex 异常:', err);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function getRangeFromIndex<T>(
  storeName: string,
  indexName: string,
  lower: unknown,
  upper: unknown,
): Promise<T[]> {
  return withRetry((database) => {
    const range = IDBKeyRange.bound(lower, upper);

    return new Promise<T[]>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.getAll(range);

        request.onsuccess = () => resolve((request.result as T[]) || []);
        request.onerror = () => reject(new Error(`Range query on ${indexName} failed`));

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for range query on ${indexName}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function countFromStore(storeName: string): Promise<number> {
  return withRetry((database) => {
    return new Promise<number>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Count operation failed'));

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for count in ${storeName}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function clearStore(storeName: string): Promise<void> {
  return withRetry((database) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Clear operation failed'));

        transaction.oncomplete = () => {};
        transaction.onerror = () => reject(new Error(`Transaction failed for clear in ${storeName}`));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function batchPut<T>(storeName: string, items: T[]): Promise<void> {
  if (items.length === 0) return;

  console.log('[database] batchPut 开始执行:', { storeName, itemsCount: items.length });
  return withRetry((database) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);

        let completed = 0;
        let failed = false;
        const total = items.length;

        for (const item of items) {
          const request = store.put(item);
          request.onsuccess = () => {
            completed++;
            if (!failed && completed === total) {
              console.log('[database] batchPut 全部完成:', { completed, total });
              resolve();
            }
          };
          request.onerror = () => {
            if (!failed) {
              failed = true;
              const errorMsg = `Batch put operation failed at item ${completed + 1}/${total}`;
              console.error('[database] batchPut 失败:', errorMsg);
              reject(new Error(errorMsg));
            }
          };
        }

        transaction.oncomplete = () => {
          if (!failed && completed === total) {
            resolve();
          }
        };
        transaction.onerror = () => {
          if (!failed) {
            failed = true;
            reject(new Error('Batch put transaction failed'));
          }
        };
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}
