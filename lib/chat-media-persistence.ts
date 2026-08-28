import type { Provider } from "./constants.ts";
import { sanitizeMediaUrl, type MediaKind } from "./media-url.ts";

export type ChatImageAsset = {
  id: string;
  dataUrl: string;
  mimeType: string;
  model?: string;
  provider?: Provider;
};

export type ChatMediaAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  dataUrl: string;
  mimeType: string;
  model?: string;
};

export type ChatAttachmentAsset = {
  id: string;
  kind: "image" | "pdf" | "text";
  name: string;
  mimeType: string;
  size?: number;
  dataUrl?: string;
  text?: string;
  pagesRead?: number;
  totalPages?: number;
  truncated?: boolean;
};

export const sanitizeChatImageAssets = (value: unknown): ChatImageAsset[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((img) => {
      if (!img || typeof img !== "object") return null;
      const imgRecord = img as Record<string, unknown>;
      const id = typeof imgRecord.id === "string" ? imgRecord.id : "";
      const dataUrl = sanitizeMediaUrl(imgRecord.dataUrl, {
        kind: "image",
        allowBlob: false,
      });
      const mimeType =
        typeof imgRecord.mimeType === "string" ? imgRecord.mimeType : "image/png";
      const model =
        typeof imgRecord.model === "string" && imgRecord.model.trim()
          ? imgRecord.model.trim()
          : undefined;
      const provider =
        imgRecord.provider === "gemini" ||
        imgRecord.provider === "navy" ||
        imgRecord.provider === "chutes" ||
        imgRecord.provider === "openrouter" ||
        imgRecord.provider === "nanogpt" ||
        imgRecord.provider === "multillm"
          ? imgRecord.provider
          : undefined;
      if (!id || !dataUrl) return null;
      return {
        id,
        dataUrl,
        mimeType,
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
      };
    })
    .filter((entry): entry is ChatImageAsset => !!entry);
};

export const sanitizeChatMediaAssets = (value: unknown): ChatMediaAsset[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const mediaRecord = item as Record<string, unknown>;
      const id = typeof mediaRecord.id === "string" ? mediaRecord.id : "";
      const kind = mediaRecord.kind;
      const mimeType =
        typeof mediaRecord.mimeType === "string" ? mediaRecord.mimeType : "";
      const model =
        typeof mediaRecord.model === "string" && mediaRecord.model.trim()
          ? mediaRecord.model.trim()
          : undefined;
      if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
      const dataUrl = sanitizeMediaUrl(mediaRecord.dataUrl, {
        kind,
        allowBlob: false,
      });
      if (!id || !dataUrl) return null;
      return {
        id,
        kind,
        dataUrl,
        mimeType:
          mimeType ||
          (kind === "video"
            ? "video/mp4"
            : kind === "audio"
              ? "audio/mpeg"
              : "image/png"),
        ...(model ? { model } : {}),
      };
    })
    .filter((entry): entry is ChatMediaAsset => !!entry);
};

export const sanitizeChatAttachmentAssets = (
  value: unknown
): ChatAttachmentAsset[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const kind = record.kind;
      const name =
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : "";
      const mimeType =
        typeof record.mimeType === "string" && record.mimeType.trim()
          ? record.mimeType.trim()
          : kind === "pdf"
            ? "application/pdf"
            : kind === "image"
              ? "image/png"
              : "text/plain";
      const size =
        typeof record.size === "number" && Number.isFinite(record.size)
          ? record.size
          : undefined;
      const dataUrl =
        kind === "image"
          ? sanitizeMediaUrl(record.dataUrl, {
              kind: "image",
              allowBlob: false,
            }) ?? undefined
          : undefined;
      const text =
        typeof record.text === "string" && record.text.trim()
          ? record.text.trim()
          : undefined;
      const pagesRead =
        typeof record.pagesRead === "number" && Number.isFinite(record.pagesRead)
          ? record.pagesRead
          : undefined;
      const totalPages =
        typeof record.totalPages === "number" && Number.isFinite(record.totalPages)
          ? record.totalPages
          : undefined;
      const truncated =
        typeof record.truncated === "boolean" ? record.truncated : undefined;

      if (!id || !name) return null;
      if (kind !== "image" && kind !== "pdf" && kind !== "text") return null;
      if (kind === "image" && !dataUrl) return null;
      if ((kind === "pdf" || kind === "text") && !text) return null;

      return {
        id,
        kind,
        name,
        mimeType,
        ...(size !== undefined ? { size } : {}),
        ...(dataUrl ? { dataUrl } : {}),
        ...(text ? { text } : {}),
        ...(pagesRead !== undefined ? { pagesRead } : {}),
        ...(totalPages !== undefined ? { totalPages } : {}),
        ...(truncated !== undefined ? { truncated } : {}),
      };
    })
    .filter((entry): entry is ChatAttachmentAsset => !!entry);
};

export type UnsafeChatMediaAsset = {
  messageId: string;
  field: "images" | "media" | "attachments";
  asset: unknown;
};

const unsafeChatAsset = (asset: unknown, fallbackKind: MediaKind) => {
  if (!asset || typeof asset !== "object") return false;
  const record = asset as Record<string, unknown>;
  if (typeof record.dataUrl !== "string" || !record.dataUrl.trim()) return false;
  const kind =
    record.kind === "image" ||
    record.kind === "video" ||
    record.kind === "audio"
      ? record.kind
      : fallbackKind;
  return (
    sanitizeMediaUrl(record.dataUrl, {
      kind,
      allowBlob: false,
    }) === null
  );
};

export const collectUnsafeChatMediaAssets = (
  value: unknown
): UnsafeChatMediaAsset[] => {
  if (!Array.isArray(value)) return [];
  const unsafe: UnsafeChatMediaAsset[] = [];

  for (const message of value) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const messageId = typeof record.id === "string" ? record.id : "";
    for (const [field, fallbackKind] of [
      ["images", "image"],
      ["media", "image"],
      ["attachments", "image"],
    ] as const) {
      const assets = record[field];
      if (!Array.isArray(assets)) continue;
      for (const asset of assets) {
        if (unsafeChatAsset(asset, fallbackKind)) {
          unsafe.push({ messageId, field, asset });
        }
      }
    }
  }

  return unsafe;
};

export const stripHeavyMediaFromMessagesForStorage = <
  T extends { images?: unknown; media?: unknown; attachments?: unknown }
>(
  messages: T[],
  maxMessages: number
) =>
  messages.slice(-maxMessages).map((message) => {
    const clonedMessage = { ...message };
    delete clonedMessage.images;
    delete clonedMessage.media;
    delete clonedMessage.attachments;
    return clonedMessage;
  });
