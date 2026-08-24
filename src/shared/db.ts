/**
 * IndexedDB wrapper — docs/data-model.md §6. No runtime dependency; promise-based.
 */

export const DB_NAME = 'spintax-outreach';
export const DB_VERSION = 2; // 2: journal.campaignId + row_seq indexes (additive; upgrade is idempotent)

export type StoreName = 'campaigns' | 'rows' | 'templates' | 'recipes' | 'journal' | 'assets' | 'settings';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Idempotent: creates missing stores and missing indexes on existing stores (additive migrations). */
function upgrade(db: IDBDatabase, tx: IDBTransaction): void {
  const store = (name: StoreName, keyPath: string): IDBObjectStore =>
    db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath });
  const index = (s: IDBObjectStore, name: string, keyPath: string | string[], opts?: IDBIndexParameters): void => {
    if (!s.indexNames.contains(name)) s.createIndex(name, keyPath, opts);
  };

  store('campaigns', 'id');

  const rows = store('rows', 'rowId');
  index(rows, 'campaignId', 'campaignId');
  index(rows, 'campaign_seedKey', ['campaignId', 'seedKey']);
  index(rows, 'campaign_status', ['campaignId', 'deliveryStatus']);
  index(rows, 'campaign_followupDue', ['campaignId', 'followupDueAt']);

  const templates = store('templates', 'id');
  index(templates, 'campaignId', 'campaignId');
  index(templates, 'campaign_channel_step_locale', ['campaignId', 'channel', 'step', 'locale'], { unique: true });

  const recipes = store('recipes', 'id');
  index(recipes, 'origin_route', ['key.origin', 'key.routePattern']);

  const journal = store('journal', 'id');
  index(journal, 'rowId', 'rowId');
  index(journal, 'campaignId', 'campaignId');
  index(journal, 'row_seq', ['rowId', 'seq']);

  store('assets', 'sha256');
  store('settings', 'key');
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const tx = request.transaction;
      if (tx) upgrade(request.result, tx);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    request.onblocked = () => reject(new Error('indexedDB open blocked'));
  });
  return dbPromise;
}

/** Test hook: close and forget the cached connection. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

/**
 * Run `fn` inside one transaction over `stores`; resolves when the transaction completes.
 * `fn` must only use the provided stores (requests issued via `req`).
 */
export async function runTx<T>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (get: (name: StoreName) => IDBObjectStore, tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const completion = done(tx);
  const result = await fn((name) => tx.objectStore(name), tx);
  await completion;
  return result;
}

export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return runTx(store, 'readonly', (s) => req(s(store).get(key) as IDBRequest<T | undefined>));
}

export function put<T>(store: StoreName, value: T): Promise<void> {
  return runTx(store, 'readwrite', async (s) => {
    await req(s(store).put(value));
  });
}

export function del(store: StoreName, key: IDBValidKey): Promise<void> {
  return runTx(store, 'readwrite', async (s) => {
    await req(s(store).delete(key));
  });
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return runTx(store, 'readonly', (s) => req(s(store).getAll() as IDBRequest<T[]>));
}

export function getAllByIndex<T>(store: StoreName, index: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
  return runTx(store, 'readonly', (s) => req(s(store).index(index).getAll(query) as IDBRequest<T[]>));
}

export function countByIndex(store: StoreName, index: string, query: IDBValidKey | IDBKeyRange): Promise<number> {
  return runTx(store, 'readonly', (s) => req(s(store).index(index).count(query)));
}

/** Delete the whole database (tests, "reset everything" in settings). */
export async function deleteDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
    request.onblocked = () => resolve();
  });
}
