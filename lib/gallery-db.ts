import { runIndexedDbTransaction } from "./client/indexed-db.ts";
import { runIndexedDbBatch } from "./client/indexed-db-batch.ts";
import type { StoredMediaRecord } from "./studio-media-persistence.ts";

const DB_NAME = "studio-gallery";
const DB_VERSION = 2;
const LEGACY_BLOB_STORE = "images";
const ASSETS_STORE = "assets";
const ASSET_BLOBS_STORE = "assetBlobs";
const REFERENCES_STORE = "references";
const JOBS_STORE = "jobs";
const CONVERSATIONS_STORE = "conversations";
const MODEL_CATALOGS_STORE = "modelCatalogs";
const SETTINGS_STORE = "settings";

const VERSIONED_STORES = [
  ASSETS_STORE,
  ASSET_BLOBS_STORE,
  REFERENCES_STORE,
  JOBS_STORE,
  CONVERSATIONS_STORE,
  MODEL_CATALOGS_STORE,
  SETTINGS_STORE,
] as const;

type StoreName =
  | typeof LEGACY_BLOB_STORE
  | (typeof VERSIONED_STORES)[number];

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
      if (!db.objectStoreNames.contains(LEGACY_BLOB_STORE)) {
        db.createObjectStore(LEGACY_BLOB_STORE);
      }
      for (const storeName of VERSIONED_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open IndexedDB."));
  });

const runGalleryTransaction = async <T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openGalleryDb();
  return await runIndexedDbTransaction(db, storeName, mode, callback);
};

export const putGalleryBlob = async (id: string, blob: Blob) => {
  await runGalleryTransaction(ASSET_BLOBS_STORE, "readwrite", (store) =>
    store.put(blob, id)
  );
};

export const getGalleryBlob = async (id: string) =>
  (await runGalleryTransaction<Blob | undefined>(
    ASSET_BLOBS_STORE,
    "readonly",
    (store) => store.get(id)
  )) ??
  (await runGalleryTransaction<Blob | undefined>(
    LEGACY_BLOB_STORE,
    "readonly",
    (store) => store.get(id)
  ));

export const deleteGalleryBlob = async (id: string) => {
  await runGalleryTransaction(ASSET_BLOBS_STORE, "readwrite", (store) =>
    store.delete(id)
  );
  await runGalleryTransaction(LEGACY_BLOB_STORE, "readwrite", (store) =>
    store.delete(id)
  );
};

export const clearGalleryStore = async (ids: readonly string[]) => {
  const galleryIds = ids.filter((id) => !id.startsWith("reference:"));
  if (!galleryIds.length) return;
  const stores = [ASSET_BLOBS_STORE, LEGACY_BLOB_STORE, ASSETS_STORE];
  await runIndexedDbBatch(await openGalleryDb(), stores, (transaction) => {
    for (const storeName of stores) {
      const store = transaction.objectStore(storeName);
      for (const id of galleryIds) {
        if (storeName === ASSETS_STORE) store.put({ id, deleted: true }, id);
        else store.delete(id);
      }
    }
  });
};

export const putGalleryAssets = async (entries: { metadata: StoredMediaRecord; blob: Blob }[]) => {
  if (!entries.length) return;
  await runIndexedDbBatch(await openGalleryDb(), [ASSET_BLOBS_STORE, ASSETS_STORE], (transaction) => {
    for (const { metadata, blob } of entries) {
      transaction.objectStore(ASSET_BLOBS_STORE).put(blob, metadata.id);
      const { id, prompt, model, provider, createdAt, kind, mimeType } = metadata;
      const record = { id, prompt, model, provider, createdAt, kind, mimeType };
      transaction.objectStore(ASSETS_STORE).put(record, metadata.id);
    }
  });
};

export const listGalleryAssetRecords = async () =>
  await runGalleryTransaction<unknown[]>(ASSETS_STORE, "readonly", (store) => store.getAll());

export const putReferenceRecord = async <T extends { id: string }>(
  reference: T
) => {
  await runGalleryTransaction(REFERENCES_STORE, "readwrite", (store) =>
    store.put(reference, reference.id)
  );
};

export const listReferenceRecords = async <T>() =>
  await runGalleryTransaction<T[]>(REFERENCES_STORE, "readonly", (store) =>
    store.getAll()
  );

export const deleteReferenceRecord = async (id: string) => {
  await runGalleryTransaction(REFERENCES_STORE, "readwrite", (store) =>
    store.delete(id)
  );
};

export const putPersistedJobRecord = async <T extends { id: string }>(
  job: T
) => {
  await runGalleryTransaction(JOBS_STORE, "readwrite", (store) =>
    store.put(job, job.id)
  );
};

export const listPersistedJobRecords = async <T>() =>
  await runGalleryTransaction<T[]>(JOBS_STORE, "readonly", (store) =>
    store.getAll()
  );

export const deletePersistedJobRecord = async (id: string) => {
  await runGalleryTransaction(JOBS_STORE, "readwrite", (store) =>
    store.delete(id)
  );
};

export const clearPersistedJobRecords = async () => {
  await runGalleryTransaction(JOBS_STORE, "readwrite", (store) => store.clear());
};
