import { sanitizeMediaUrl } from "./media-url.ts";

export const MAX_IMAGE_REFERENCE_ITEMS = 5;
export const MAX_IMAGE_REFERENCE_BYTES = 50 * 1024 * 1024;

export const hasMediaReferencePayload = (value: unknown) =>
  value !== undefined && value !== null &&
  (!Array.isArray(value) || value.length > 0);

export const normalizeImageReferencePayload = (
  value: unknown,
  maxItems = MAX_IMAGE_REFERENCE_ITEMS
): string | string[] | undefined => {
  if (!Number.isSafeInteger(maxItems) || maxItems <= 0) return undefined;

  if (Array.isArray(value)) {
    if (!value.length) return undefined;
    if (value.length > maxItems) return undefined;

    const normalized: string[] = [];
    for (const item of value) {
      const url = sanitizeMediaUrl(item, {
        kind: "image",
        allowBlob: false,
        allowData: true,
        maxBytes: MAX_IMAGE_REFERENCE_BYTES,
      });
      if (!url) return undefined;
      if (!normalized.includes(url)) normalized.push(url);
    }
    return normalized.length ? normalized : undefined;
  }

  return (
    sanitizeMediaUrl(value, {
      kind: "image",
      allowBlob: false,
      allowData: true,
      maxBytes: MAX_IMAGE_REFERENCE_BYTES,
    }) ?? undefined
  );
};
