import { DB_NAME, STORE_SAVES, STORE_MESSAGES } from '@/config/constants';

const DB_VERSION = 3;

let db: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (db) {
    return Promise.resolve(db);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
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
      db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onerror = (event: Event) => {
      reject(new Error(`IndexedDB open failed: ${(event.target as IDBOpenDBRequest).error?.message}`));
    };
  });
}

export async function getFromStore<T>(storeName: string, key: string): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(new Error(`Get failed for key ${key}`));
  });
}

export async function putToStore<T>(storeName: string, value: T): Promise<void> {
  const database = await openDatabase();
  console.log('[database] putToStore 开始保存:', { storeName, value });
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);

    request.onsuccess = () => {
      console.log('[database] putToStore 成功:', { storeName, value });
      resolve();
    };
    request.onerror = (event) => {
      const errorMsg = (event.target as any).error?.message || 'Unknown IndexedDB error';
      console.error(`[database] putToStore failed (${storeName}):`, errorMsg, value);
      reject(new Error(`Put failed: ${errorMsg}`));
    };
  });
}

export async function deleteFromStore(storeName: string, key: string): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Delete failed for key ${key}`));
  });
}

export async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(new Error('Get all operation failed'));
  });
}

export async function getAllFromIndex<T>(
  storeName: string,
  indexName: string,
  value: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  const database = await openDatabase();
  console.log('[database] getAllFromIndex 开始查询:', { storeName, indexName, value });
  return new Promise<T[]>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);

    request.onsuccess = () => {
      console.log('[database] getAllFromIndex 查询结果:', { storeName, indexName, resultCount: request.result.length, results: request.result });
      resolve(request.result as T[]);
    };
    request.onerror = (event: Event) => reject(new Error(`Get all from index ${indexName} failed: ${(event.target as IDBRequest).error?.message || 'Unknown error'}`));
  });
}

export async function getRangeFromIndex<T>(
  storeName: string,
  indexName: string,
  lower: unknown,
  upper: unknown,
): Promise<T[]> {
  const database = await openDatabase();
  const range = IDBKeyRange.bound(lower, upper);

  return new Promise<T[]>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(range);

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(new Error(`Range query on ${indexName} failed`));
  });
}

export async function countFromStore(storeName: string): Promise<number> {
  const database = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Count operation failed'));
  });
}

export async function clearStore(storeName: string): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Clear operation failed'));
  });
}

export async function batchPut<T>(storeName: string, items: T[]): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);

    let completed = 0;
    let failed = false;

    for (const item of items) {
      const request = store.put(item);
      request.onsuccess = () => {
        completed++;
        if (!failed && completed === items.length) {
          resolve();
        }
      };
      request.onerror = () => {
        if (!failed) {
          failed = true;
          reject(new Error('Batch put operation failed'));
        }
      };
    }

    if (items.length === 0) {
      resolve();
    }
  });
}
