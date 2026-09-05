import { partitionStoredMediaRecords, type StoredMediaRecord } from "./studio-media-persistence.ts";

export const mergeDurableGalleryRecords = (legacy: StoredMediaRecord[], durable: unknown[]): StoredMediaRecord[] => {
  const records = new Map(partitionStoredMediaRecords(legacy).accepted.map((item) => [item.id, item]));
  for (const value of durable) {
    if (!value || typeof value !== "object") continue;
    if ("deleted" in value && value.deleted === true && "id" in value && typeof value.id === "string") {
      records.delete(value.id);
      continue;
    }
    for (const item of partitionStoredMediaRecords([value]).accepted) records.set(item.id, item);
  }
  return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 250);
};
