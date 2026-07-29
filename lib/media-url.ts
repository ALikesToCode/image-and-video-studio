import {
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  parseDataUrl,
} from "./studio-validation.ts";

export type MediaKind = "image" | "video" | "audio";

type SanitizeMediaUrlOptions = {
  kind: MediaKind;
  allowBlob?: boolean;
  allowData?: boolean;
};

const MIME_TYPES_BY_KIND: Record<MediaKind, readonly string[]> = {
  image: IMAGE_MIME_TYPES,
  video: VIDEO_MIME_TYPES,
  audio: AUDIO_MIME_TYPES,
};

const isRuntimeBlobUrl = (value: string) => {
  const target = value.slice("blob:".length);
  if (/^null\/[^\s]+$/.test(target)) return true;

  try {
    const parsed = new URL(target);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
};

export const sanitizeMediaUrl = (
  value: unknown,
  {
    kind,
    allowBlob = false,
    allowData = true,
  }: SanitizeMediaUrlOptions
) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^data:/i.test(trimmed)) {
    if (!allowData) return null;
    return parseDataUrl(trimmed, MIME_TYPES_BY_KIND[kind])?.dataUrl ?? null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol === "https:") {
    return !parsed.username && !parsed.password ? trimmed : null;
  }

  if (parsed.protocol === "blob:" && allowBlob && isRuntimeBlobUrl(trimmed)) {
    return trimmed;
  }

  return null;
};

export const isSafeMediaUrl = (
  value: unknown,
  options: SanitizeMediaUrlOptions
) => sanitizeMediaUrl(value, options) !== null;
