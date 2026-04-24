export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/opus",
  "audio/aac",
  "audio/flac",
] as const;

export type ParsedDataUrl = {
  dataUrl: string;
  mimeType: string;
  data: string;
};

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const normalizeMimeType = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
};

export const isAllowedMimeType = (
  value: unknown,
  allowed: readonly string[]
) => {
  const normalized = normalizeMimeType(value);
  return allowed.includes(normalized);
};

export const isValidModelId = (value: unknown) =>
  typeof value === "string" && MODEL_ID_PATTERN.test(value.trim());

export const parseDataUrl = (
  value: unknown,
  allowedMimeTypes: readonly string[] = [
    ...IMAGE_MIME_TYPES,
    ...VIDEO_MIME_TYPES,
    ...AUDIO_MIME_TYPES,
  ]
): ParsedDataUrl | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^data:([^,]+),([\s\S]+)$/.exec(trimmed);
  if (!match) return null;

  const header = match[1];
  const data = match[2].replace(/\s/g, "");
  const parts = header.split(";").map((part) => part.trim().toLowerCase());
  const mimeType = normalizeMimeType(parts[0]);
  if (!parts.includes("base64")) return null;
  if (!isAllowedMimeType(mimeType, allowedMimeTypes)) return null;
  if (!data || data.length % 4 === 1 || !BASE64_PATTERN.test(data)) return null;

  return {
    dataUrl: `data:${mimeType};base64,${data}`,
    mimeType,
    data,
  };
};

export const dataUrlToInlineData = (
  value: unknown,
  allowedMimeTypes: readonly string[] = IMAGE_MIME_TYPES
) => {
  const parsed = parseDataUrl(value, allowedMimeTypes);
  if (!parsed) return null;
  return {
    inlineData: {
      mimeType: parsed.mimeType,
      data: parsed.data,
    },
  };
};

export const sanitizeDataUrls = (
  values: unknown,
  allowedMimeTypes: readonly string[] = IMAGE_MIME_TYPES,
  maxItems = 10
) => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => parseDataUrl(value, allowedMimeTypes))
    .filter((value): value is ParsedDataUrl => value !== null)
    .slice(0, maxItems);
};

export const isAllowedChoice = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T => typeof value === "string" && allowed.includes(value as T);

export const coerceIntegerInRange = (
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number }
) => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
};

export const coerceNumberInRange = (
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number }
) => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export const requiresEightSecondVeoDuration = ({
  resolution,
  hasReferenceImages,
  hasLastFrame,
}: {
  resolution?: string;
  hasReferenceImages?: boolean;
  hasLastFrame?: boolean;
}) => {
  const normalizedResolution = resolution?.toLowerCase();
  return (
    normalizedResolution === "1080p" ||
    normalizedResolution === "4k" ||
    Boolean(hasReferenceImages) ||
    Boolean(hasLastFrame)
  );
};

export const normalizeVeoDuration = (
  duration: unknown,
  options: {
    resolution?: string;
    hasReferenceImages?: boolean;
    hasLastFrame?: boolean;
  } = {}
) => {
  if (requiresEightSecondVeoDuration(options)) return "8";
  const parsed = String(duration ?? "").trim();
  return parsed === "4" || parsed === "6" || parsed === "8" ? parsed : "8";
};
