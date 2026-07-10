import type {
  ModelInputImageConstraints,
  ModelMediaConstraint,
  ModelOption,
} from "./constants.ts";

export type ImageInputMetadata = {
  name?: string;
  mimeType?: string;
  size?: number;
};

export type StandaloneVideoModelSupport =
  | { supported: true }
  | { supported: false; reason: string };

const hasOwn = (value: object | undefined, key: string) =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const includesImage = (modalities: string[] | null | undefined) =>
  modalities?.some((entry) => entry.toLowerCase() === "image") === true;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonNegativeInteger = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= 0
    ? value
    : undefined;

const sanitizeMediaConstraint = (
  value: unknown,
): ModelMediaConstraint | undefined => {
  if (!isRecord(value)) return undefined;
  const constraint: ModelMediaConstraint = {};
  for (const key of [
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "maxBytes",
  ] as const) {
    const number = nonNegativeInteger(value[key]);
    if (number !== undefined) constraint[key] = number;
  }
  if (Array.isArray(value.formats)) {
    const formats = Array.from(
      new Set(
        value.formats
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    );
    if (formats.length) constraint.formats = formats;
  }
  for (const key of ["source", "note"] as const) {
    const text = typeof value[key] === "string" ? value[key].trim() : "";
    if (text) constraint[key] = text;
  }
  return Object.keys(constraint).length ? constraint : undefined;
};

export const sanitizeModelInputImageConstraints = (
  value: unknown,
): ModelInputImageConstraints | undefined => {
  if (!isRecord(value)) return undefined;
  const constraints: ModelInputImageConstraints = {};
  const maxItems = nonNegativeInteger(value.maxItems);
  const route = sanitizeMediaConstraint(value.route);
  const provider = sanitizeMediaConstraint(value.provider);
  if (maxItems !== undefined) constraints.maxItems = maxItems;
  if (route) constraints.route = route;
  if (provider) constraints.provider = provider;
  return Object.keys(constraints).length ? constraints : undefined;
};

const mediaModalities = (model: ModelOption) => {
  const values = new Set(
    (model.inputModalities ?? []).map((entry) => entry.trim().toLowerCase()),
  );
  const modality = (model.modality ?? "").toLowerCase();
  const inputSide = modality.includes("->")
    ? modality.split("->", 1)[0]
    : modality.includes("-to-")
      ? modality.split("-to-", 1)[0]
      : "";
  for (const entry of inputSide.split(/[^a-z0-9]+/)) {
    if (entry) values.add(entry);
  }
  return values;
};

export const getStandaloneVideoModelSupport = (
  model: ModelOption,
): StandaloneVideoModelSupport => {
  const modalities = mediaModalities(model);
  const parameterNames = new Set(
    Object.keys(model.dynamicParameters ?? {}).map((name) =>
      name.toLowerCase().replace(/[^a-z0-9]/g, ""),
    ),
  );
  const requiresVideo =
    modalities.has("video") ||
    [
      "video",
      "videourl",
      "videodataurl",
      "videoattachmentid",
      "targetvideo",
      "referencevideos",
    ].some((name) => parameterNames.has(name));
  const requiresAudio =
    modalities.has("audio") ||
    ["audio", "audiourl", "audiodataurl", "audioduration"].some((name) =>
      parameterNames.has(name),
    );
  if (requiresVideo || requiresAudio) {
    const unsupportedInputs = [
      requiresVideo ? "source video" : "",
      requiresAudio ? "audio" : "",
    ].filter(Boolean);
    return {
      supported: false,
      reason: `${model.label} requires ${unsupportedInputs.join(
        " and ",
      )} input, which the standalone video studio cannot supply yet.`,
    };
  }
  return { supported: true };
};

const canonicalImageFormat = (value: string | undefined) => {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/^image\//, "");
  if (normalized === "jpg" || normalized === "pjpeg") return "jpeg";
  if (normalized === "tif") return "tiff";
  return /^[a-z0-9][a-z0-9.+-]*$/.test(normalized) ? normalized : undefined;
};

const COMMON_IMAGE_FORMATS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jxl",
  "png",
  "svg+xml",
  "tiff",
  "webp",
]);

const inputImageFormat = (input: ImageInputMetadata) => {
  const mimeType = input.mimeType?.trim().toLowerCase();
  if (mimeType && !mimeType.startsWith("image/")) return null;
  const fromMime = canonicalImageFormat(mimeType);
  if (fromMime) return fromMime;
  const extension = input.name?.match(/\.([a-z0-9]+)$/i)?.[1];
  return canonicalImageFormat(extension);
};

const formatLabel = (format: string) =>
  format === "jpeg" ? "JPEG" : format.toUpperCase();

const allowedFormatIntersection = (constraints: ModelMediaConstraint[]) => {
  const declared = constraints
    .map((constraint) =>
      constraint.formats
        ?.map(canonicalImageFormat)
        .filter((entry): entry is string => !!entry),
    )
    .filter((formats): formats is string[] => Boolean(formats?.length));
  if (!declared.length) return undefined;
  return declared.slice(1).reduce(
    (allowed, formats) => allowed.filter((format) => formats.includes(format)),
    Array.from(new Set(declared[0])),
  );
};

const formatByteLimit = (bytes: number) => {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
};

export const validateModelImageInputs = (
  model: ModelOption | undefined,
  inputs: ImageInputMetadata[],
  label = "image input",
): string | null => {
  if (!inputs.length) return null;
  const modelLabel = model?.label ?? "This model";
  const constraints = model?.inputImageConstraints;
  const maxItems = constraints?.maxItems;
  if (typeof maxItems === "number" && inputs.length > maxItems) {
    return `${modelLabel} accepts up to ${maxItems} ${label}${maxItems === 1 ? "" : "s"}. Remove ${
      inputs.length - maxItems
    } before generating.`;
  }

  const mediaConstraints = [constraints?.route, constraints?.provider].filter(
    (entry): entry is ModelMediaConstraint => !!entry,
  );
  const byteLimits = mediaConstraints
    .map((constraint) => constraint.maxBytes)
    .filter((value): value is number => typeof value === "number");
  const maxBytes = byteLimits.length ? Math.min(...byteLimits) : undefined;
  const allowedFormats = allowedFormatIntersection(mediaConstraints);

  for (const input of inputs) {
    const name = input.name?.trim() || label;
    const format = inputImageFormat(input);
    const declaredImageMime = input.mimeType
      ?.trim()
      .toLowerCase()
      .startsWith("image/");
    if (
      format === null ||
      (!declaredImageMime &&
        (!format ||
          (!COMMON_IMAGE_FORMATS.has(format) &&
            !allowedFormats?.includes(format))))
    ) {
      return `${name} is not an image. Choose a supported image file.`;
    }
    if (allowedFormats) {
      if (!allowedFormats.length) {
        return `${modelLabel} has incompatible image-format constraints. Refresh the model catalog before generating.`;
      }
      if (!format || !allowedFormats.includes(format)) {
        return `${name} must be ${allowedFormats.map(formatLabel).join(" or ")} for ${modelLabel}.`;
      }
    }
    if (
      typeof maxBytes === "number" &&
      typeof input.size === "number" &&
      input.size > maxBytes
    ) {
      return `${name} is too large for ${modelLabel}. Use an image no larger than ${formatByteLimit(maxBytes)}.`;
    }
  }
  return null;
};

export const imageInputMetadataFromDataUrl = (
  dataUrl: string,
): ImageInputMetadata => {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return {};
  const mimeType = match[1]?.trim().toLowerCase() || undefined;
  const payload = match[2] ?? "";
  const isBase64 = /^data:[^,]*;base64,/i.test(dataUrl);
  if (!isBase64) {
    try {
      return {
        ...(mimeType ? { mimeType } : {}),
        size: new TextEncoder().encode(decodeURIComponent(payload)).byteLength,
      };
    } catch {
      return mimeType ? { mimeType } : {};
    }
  }
  const normalized = payload.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return {
    ...(mimeType ? { mimeType } : {}),
    size: Math.max(0, Math.floor((normalized.length * 3) / 4) - padding),
  };
};

export const selectModelReferenceImagesForSubmission = (
  model: ModelOption | undefined,
  sourceImage: string | null,
  referenceImages: string[],
) => {
  const uniqueReferences = Array.from(new Set(referenceImages)).filter(
    (reference) => !sourceImage || reference !== sourceImage,
  );
  const referenceLimit =
    typeof model?.maxReferenceImages === "number"
      ? Math.max(0, Math.floor(model.maxReferenceImages))
      : Number.POSITIVE_INFINITY;
  const totalInputLimit =
    typeof model?.inputImageConstraints?.maxItems === "number"
      ? Math.max(0, Math.floor(model.inputImageConstraints.maxItems))
      : Number.POSITIVE_INFINITY;
  const remainingInputSlots = Math.max(
    0,
    totalInputLimit - (sourceImage ? 1 : 0),
  );
  return uniqueReferences.slice(0, Math.min(referenceLimit, remainingInputSlots));
};

const hasKnownMediaMetadata = (model: ModelOption) =>
  model.metadataStatus === "known" ||
  model.inputModalities !== undefined ||
  model.maxReferenceImages !== undefined ||
  Boolean(model.supports && Object.keys(model.supports).length);

export const modelAcceptsImageReferences = (model?: ModelOption) => {
  if (!model) return true;
  if (model.maxReferenceImages === 0) return false;
  if (hasOwn(model.supports, "referenceImages")) {
    return model.supports?.referenceImages === true;
  }
  if (typeof model.maxReferenceImages === "number") {
    return model.maxReferenceImages > 0;
  }
  if (model.supports?.imageEdit === true) return true;
  if (includesImage(model.inputModalities)) return true;
  return !hasKnownMediaMetadata(model);
};

export const modelAcceptsSourceImage = (model?: ModelOption) => {
  if (!model) return true;
  if (hasOwn(model.supports, "sourceImage")) {
    return model.supports?.sourceImage === true;
  }
  if (model.supports?.firstFrame === true || model.supports?.imageEdit === true) {
    return true;
  }
  if (includesImage(model.inputModalities)) return true;
  return !hasKnownMediaMetadata(model);
};

export const getModelReferenceLimit = (model?: ModelOption) => {
  if (!model) return undefined;
  if (typeof model.maxReferenceImages === "number") {
    return Math.max(0, Math.floor(model.maxReferenceImages));
  }
  return modelAcceptsImageReferences(model) ? undefined : 0;
};
