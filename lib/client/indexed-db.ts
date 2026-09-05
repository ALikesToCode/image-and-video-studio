export const runIndexedDbTransaction = async <T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      transaction.onabort = () => reject(
        transaction.error ?? new Error("IndexedDB transaction aborted."),
      );
      transaction.onerror = () => reject(
        transaction.error ?? new Error("IndexedDB transaction failed."),
      );
      try {
        const request = operation(transaction.objectStore(storeName));
        request.onerror = () => reject(
          request.error ?? new Error("IndexedDB request failed."),
        );
        // Request success can still be followed by a quota or commit failure.
        transaction.oncomplete = () => resolve(request.result);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
};
