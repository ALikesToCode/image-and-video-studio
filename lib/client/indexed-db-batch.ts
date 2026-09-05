export const runIndexedDbBatch = async (
  db: IDBDatabase,
  stores: string[],
  operation: (transaction: IDBTransaction) => void,
): Promise<void> => {
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(stores, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Storage transaction aborted."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Storage transaction failed."));
      try { operation(transaction); }
      catch (error) { transaction.abort(); reject(error); }
    });
  } finally { db.close(); }
};
