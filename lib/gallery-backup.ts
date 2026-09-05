import type { Provider } from "./constants.ts";
import type { StoredMedia } from "./types.ts";
import { sanitizeMediaUrl } from "./media-url.ts";
import { AUDIO_MIME_TYPES, IMAGE_MIME_TYPES, VIDEO_MIME_TYPES, parseDataUrl } from "./studio-validation.ts";

export const MAX_GALLERY_BACKUP_BYTES = 64 * 1024 * 1024;
export const MAX_GALLERY_ITEMS = 250;
const MIME_TYPES = { image: IMAGE_MIME_TYPES, video: VIDEO_MIME_TYPES, audio: AUDIO_MIME_TYPES };
const PROVIDERS: Provider[] = ["gemini", "navy", "chutes", "openrouter", "nanogpt", "multillm"];

export const parseGalleryBackup = (text: string): StoredMedia[] => {
  if (new TextEncoder().encode(text).byteLength > MAX_GALLERY_BACKUP_BYTES) throw new Error("Gallery backups must be 64 MB or smaller.");
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (!payload || typeof payload !== "object" || !("assets" in payload) || !Array.isArray(payload.assets)) throw new Error("This file is not a gallery backup.");
  if ("version" in payload && payload.version !== 1) throw new Error("This gallery backup version is not supported.");
  if (payload.assets.length > MAX_GALLERY_ITEMS) throw new Error("A gallery backup can contain up to 250 assets.");
  const ids = new Set<string>();
  return payload.assets.map((value: unknown, index: number) => {
    if (!value || typeof value !== "object") throw new Error(`Asset ${index + 1} is invalid.`);
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id) ||
      !PROVIDERS.includes(item.provider as Provider) || !["image", "video", "audio"].includes(String(item.kind)) ||
      typeof item.model !== "string" || !item.model.trim() || item.model.length > 256 ||
      typeof item.prompt !== "string" || item.prompt.length > 100_000 ||
      typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) {
      throw new Error(`Asset ${index + 1} has invalid or duplicate metadata.`);
    }
    const kind = item.kind as StoredMedia["kind"];
    const parsed = parseDataUrl(item.dataUrl, MIME_TYPES[kind], MAX_GALLERY_BACKUP_BYTES);
    if (!parsed) throw new Error(`Asset ${index + 1} must include embedded ${kind} data. Older exports containing blob URLs cannot be restored.`);
    ids.add(item.id);
    return { id: item.id, kind, provider: item.provider as Provider, model: item.model, prompt: item.prompt,
      createdAt: item.createdAt, dataUrl: parsed.dataUrl, mimeType: parsed.mimeType };
  });
};

export const galleryAssetBlob = (item: StoredMedia): Blob => {
  const parsed = parseDataUrl(item.dataUrl, MIME_TYPES[item.kind], MAX_GALLERY_BACKUP_BYTES);
  if (!parsed) throw new Error("The asset does not contain valid embedded media.");
  const bytes = Uint8Array.from(atob(parsed.data), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: parsed.mimeType });
};

const readEmbeddedMedia = async (item: StoredMedia, maxBytes: number): Promise<string> => {
  const url = sanitizeMediaUrl(item.dataUrl, { kind: item.kind, allowBlob: true });
  if (!url) throw new Error("An asset has an unsupported media URL.");
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to read asset ${item.id}.`);
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? item.mimeType ?? "";
  if (!(MIME_TYPES[item.kind] as readonly string[]).includes(mime)) throw new Error(`Asset ${item.id} has an unsupported media type.`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("This export exceeds 64 MB. Filter the gallery to export fewer assets.");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let binary = "";
  for (const part of parts) {
    for (let offset = 0; offset < part.length; offset += 8192) binary += String.fromCharCode(...part.subarray(offset, offset + 8192));
  }
  return `data:${mime};base64,${btoa(binary)}`;
};

export const exportGalleryBackup = async (
  items: readonly StoredMedia[],
  readMedia = readEmbeddedMedia,
): Promise<string> => {
  const assets: StoredMedia[] = [];
  let usedBytes = 128;
  for (const item of items) {
    const dataUrl = await readMedia(item, Math.max(0, Math.floor((MAX_GALLERY_BACKUP_BYTES - usedBytes) * 0.7)));
    const asset = { ...item, dataUrl };
    usedBytes += new TextEncoder().encode(JSON.stringify(asset)).byteLength + 1;
    if (usedBytes > MAX_GALLERY_BACKUP_BYTES) throw new Error("This export exceeds 64 MB. Filter the gallery to export fewer assets.");
    assets.push(asset);
  }
  const text = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), assets });
  parseGalleryBackup(text);
  return text;
};

export const mergeGalleryImport = (existing: readonly StoredMedia[], incoming: readonly StoredMedia[]) => {
  const ids = new Set(existing.map((item) => item.id));
  const additions = incoming.filter((item) => !ids.has(item.id));
  if (existing.length + additions.length > MAX_GALLERY_ITEMS) throw new Error("The gallery holds 250 assets. Export or remove some before importing this backup.");
  return additions;
};
