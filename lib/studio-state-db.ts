import { runIndexedDbTransaction } from "./client/indexed-db.ts";

const DB_NAME = "studio-state";
const DB_VERSION = 1;
const STORE_NAME = "state";

const isIndexedDbAvailable = () => typeof indexedDB !== "undefined";

const openStateDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open IndexedDB."));
  });

const runStateTransaction = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openStateDb();
  return await runIndexedDbTransaction(db, STORE_NAME, mode, callback);
};

export const putStudioState = async (key: string, value: unknown) => {
  await runStateTransaction("readwrite", (store) => store.put(value, key));
};

export const getStudioState = async <T>(key: string) =>
  await runStateTransaction<T | undefined>("readonly", (store) => store.get(key));

export const deleteStudioState = async (key: string) => {
  await runStateTransaction("readwrite", (store) => store.delete(key));
};

export const clearStudioState = async () => {
  await runStateTransaction("readwrite", (store) => store.clear());
};

export const isStudioStateAvailable = isIndexedDbAvailable;
