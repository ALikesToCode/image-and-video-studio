import type { Provider } from "./constants.ts";
import { mergeUnsafeMediaBackup } from "./media-backup.ts";
import { sanitizeMediaUrl } from "./media-url.ts";
import type { GeneratedImage, StoredMedia } from "./types.ts";

export type StoredMediaRecord = Omit<StoredMedia, "dataUrl" | "kind"> & {
  dataUrl?: string;
  kind?: StoredMedia["kind"];
  mimeType?: string;
};

type Partition<T> = {
  accepted: T[];
  rejected: unknown[];
};

type MediaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProvider = (value: unknown): value is Provider =>
  value === "gemini" ||
  value === "navy" ||
  value === "chutes" ||
  value === "openrouter" ||
  value === "nanogpt" ||
  value === "multillm";

const mediaKind = (value: unknown): StoredMedia["kind"] =>
  value === "video" || value === "audio" ? value : "image";

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const partitionStoredMediaRecords = (
  value: unknown
): Partition<StoredMediaRecord> => {
  if (!Array.isArray(value)) return { accepted: [], rejected: [] };

  const accepted: StoredMediaRecord[] = [];
  const rejected: unknown[] = [];
  for (const item of value) {
    if (!isRecord(item) ||
      typeof item.id !== "string" || !item.id.trim() || item.id.startsWith("reference:") ||
      typeof item.prompt !== "string" || typeof item.model !== "string" ||
      !isProvider(item.provider) || typeof item.createdAt !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt))) {
      rejected.push(item);
      continue;
    }

    const kind = mediaKind(item.kind);
    const rawUrl = typeof item.dataUrl === "string" ? item.dataUrl : undefined;
    const dataUrl =
      rawUrl === undefined
        ? undefined
        : sanitizeMediaUrl(rawUrl, { kind, allowBlob: false });
    if (rawUrl !== undefined && !dataUrl) {
      rejected.push(item);
      continue;
    }

    accepted.push({
      ...(item as StoredMediaRecord),
      kind,
      ...(dataUrl ? { dataUrl } : {}),
    });
  }

  return { accepted, rejected };
};

export const partitionGeneratedImages = (
  value: unknown,
  maxItems = 250
): Partition<GeneratedImage> => {
  if (!Array.isArray(value)) return { accepted: [], rejected: [] };

  const accepted: GeneratedImage[] = [];
  const rejected: unknown[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      rejected.push(item);
      continue;
    }

    const dataUrl = sanitizeMediaUrl(item.dataUrl, {
      kind: "image",
      allowBlob: false,
    });
    if (!dataUrl) {
      rejected.push(item);
      continue;
    }

    const mimeType =
      typeof item.mimeType === "string" ? item.mimeType : "image/png";
    const id = typeof item.id === "string" ? item.id : createId();
    const model =
      typeof item.model === "string" && item.model ? item.model : undefined;
    const prompt =
      typeof item.prompt === "string" && item.prompt ? item.prompt : undefined;
    const provider = isProvider(item.provider) ? item.provider : undefined;
    const batchId =
      typeof item.batchId === "string" && item.batchId
        ? item.batchId
        : undefined;
    const batchCreatedAt =
      typeof item.batchCreatedAt === "string" && item.batchCreatedAt
        ? item.batchCreatedAt
        : undefined;
    const batchOrder =
      typeof item.batchOrder === "number" ? item.batchOrder : undefined;
    const imageOrder =
      typeof item.imageOrder === "number" ? item.imageOrder : undefined;
    const createdAt =
      typeof item.createdAt === "string" && item.createdAt
        ? item.createdAt
        : undefined;

    if (accepted.length < maxItems) {
      accepted.push({
        id,
        dataUrl,
        mimeType,
        ...(model ? { model } : {}),
        ...(prompt ? { prompt } : {}),
        ...(provider ? { provider } : {}),
        ...(batchId ? { batchId } : {}),
        ...(batchCreatedAt ? { batchCreatedAt } : {}),
        ...(batchOrder !== undefined ? { batchOrder } : {}),
        ...(imageOrder !== undefined ? { imageOrder } : {}),
        ...(createdAt ? { createdAt } : {}),
      });
    }
  }

  return { accepted, rejected };
};

export const unsafeMediaBackupKey = (storageKey: string) =>
  `${storageKey}_unsafe_media_backup_v1`;

export const backupAndPruneUnsafeMediaRecords = <T>(
  storage: MediaStorage,
  storageKey: string,
  partition: Partition<T>
) => {
  if (!partition.rejected.length) return false;

  const backupKey = unsafeMediaBackupKey(storageKey);
  let existingBackup: unknown = null;
  const rawBackup = storage.getItem(backupKey);
  if (rawBackup) {
    try {
      existingBackup = JSON.parse(rawBackup) as unknown;
    } catch {
      existingBackup = null;
    }
  }

  storage.setItem(
    backupKey,
    JSON.stringify(
      mergeUnsafeMediaBackup(existingBackup, partition.rejected)
    )
  );
  if (partition.accepted.length) {
    storage.setItem(storageKey, JSON.stringify(partition.accepted));
  } else {
    storage.removeItem(storageKey);
  }
  return true;
};
