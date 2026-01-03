const DB_NAME = "studio-gallery";
const DB_VERSION = 1;
const STORE_NAME = "images";

export const isIndexedDbAvailable = () => typeof indexedDB !== "undefined";

const openGalleryDb = () =>
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

const runGalleryTransaction = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openGalleryDb();
  return await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);
    let settled = false;

    request.onsuccess = () => {
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("IndexedDB request failed."));
    };

    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };
    transaction.onerror = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
    transaction.oncomplete = () => {
      settled = true;
    };
  });
};

export const putGalleryBlob = async (id: string, blob: Blob) => {
  await runGalleryTransaction("readwrite", (store) => store.put(blob, id));
};

export const getGalleryBlob = async (id: string) =>
  await runGalleryTransaction<Blob | undefined>("readonly", (store) =>
    store.get(id)
  );

export const deleteGalleryBlob = async (id: string) => {
  await runGalleryTransaction("readwrite", (store) => store.delete(id));
};

export const clearGalleryStore = async () => {
  await runGalleryTransaction("readwrite", (store) => store.clear());
};
