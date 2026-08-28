import type {
  ModelOption,
  ModelParameterValue,
} from "./constants.ts";
import {
  buildModelParameterPayload,
  resolveModelParameterValues,
} from "./model-capability-settings.ts";
import { resolveMaximumImageQualityRequest } from "./image-quality.ts";
import type { ChatMediaAsset } from "./chat-media-persistence.ts";

export type ChatMediaPreview = {
  imageUrl: string;
  prompt: string;
  model: string;
  provider: string;
  kind: ChatMediaAsset["kind"];
  mimeType: string | null;
};

const toolStringArgument = (
  args: Record<string, unknown>,
  keys: string[],
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const toolNumberArgument = (
  args: Record<string, unknown>,
  keys: string[],
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const toolImageArguments = (args: Record<string, unknown>) => {
  const value = args.image_url ?? args.image;
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizedModalities = (value?: string[] | null) =>
  (value ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);

export const isChatVideoModelSupported = (model: ModelOption) => {
  if (model.provider !== "nanogpt") return true;
  const inputModalities = normalizedModalities(model.inputModalities);
  const outputModalities = normalizedModalities(model.outputModalities);
  if (inputModalities.some((entry) => entry === "video" || entry === "audio")) {
    return false;
  }
  const producesVideo =
    model.supports?.video === true || outputModalities.includes("video");
  const acceptsSupportedInput =
    model.supports?.textToVideo === true ||
    model.supports?.imageToVideo === true ||
    inputModalities.some((entry) => entry === "text" || entry === "image") ||
    inputModalities.length === 0;
  return producesVideo && acceptsSupportedInput;
};

export const buildNanoGptImageToolRequest = ({
  model,
  prompt,
  args,
  preferMaximumImageQuality = false,
}: {
  model: ModelOption;
  prompt: string;
  args: Record<string, unknown>;
  preferMaximumImageQuality?: boolean;
}) => {
  const requestedResolution = toolStringArgument(args, ["resolution", "size"]);
  const supportedResolutions = model.supportedResolutions ?? [];
  const requestedQuality = toolStringArgument(args, ["quality"]);
  const maximumQuality = resolveMaximumImageQualityRequest({
    enabled: preferMaximumImageQuality,
    provider: "nanogpt",
    model: model.id,
    modelOption: model,
    request: {
      aspectRatio: toolStringArgument(args, ["aspect_ratio", "aspectRatio"]),
      resolution: requestedResolution,
      quality: requestedQuality,
    },
  });
  const resolution = maximumQuality.resolution || supportedResolutions[0];
  const supportsReferenceImages =
    model.supports?.referenceImages === true ||
    (model.supports?.referenceImages !== false &&
      (typeof model.maxReferenceImages === "number" ||
        normalizedModalities(model.inputModalities).includes("image")));
  const maxReferenceImages = supportsReferenceImages
    ? Math.max(0, model.maxReferenceImages ?? 1)
    : 0;
  const references = toolImageArguments(args).slice(0, maxReferenceImages);
  const quality = maximumQuality.quality;
  const seed = toolNumberArgument(args, ["seed"]);
  const fixedOutputImages =
    typeof model.fixedOutputImages === "number" && model.fixedOutputImages > 0
      ? Math.round(model.fixedOutputImages)
      : undefined;

  return {
    model: model.id,
    prompt,
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {}),
    ...(model.supports?.seed === true && seed !== undefined
      ? { seed: Math.round(seed) }
      : {}),
    numberOfImages: fixedOutputImages ?? 1,
    ...(references.length ? { input_references: references } : {}),
    modelCapabilities: {
      supportedResolutions,
      maxOutputImages: model.maxOutputImages,
      fixedOutputImages: model.fixedOutputImages,
      maxReferenceImages,
      supportsReferenceImages,
    },
  };
};

const nanoVideoParameterArgument = (
  parameterName: string,
  args: Record<string, unknown>,
) => {
  const normalized = parameterName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/duration|seconds|length/.test(normalized)) {
    return toolNumberArgument(args, ["seconds"]);
  }
  if (/aspectratio|ratio/.test(normalized)) {
    return toolStringArgument(args, ["size"]);
  }
  if (/resolution|size/.test(normalized)) {
    return toolStringArgument(args, ["size"]);
  }
  if (/guidance/.test(normalized)) {
    return toolNumberArgument(args, ["guidance_scale_2"]);
  }
  if (normalized === "fps" || normalized.endsWith("fps")) {
    return toolNumberArgument(args, ["fps"]);
  }
  if (normalized === "seed" || normalized.endsWith("seed")) {
    return toolNumberArgument(args, ["seed"]);
  }
  return undefined;
};

export const buildNanoGptVideoToolRequest = ({
  model,
  prompt,
  sourceImage,
  args,
}: {
  model: ModelOption;
  prompt: string;
  sourceImage?: string;
  args: Record<string, unknown>;
}) => {
  const dynamicValues: Record<string, ModelParameterValue> = {};
  for (const key of Object.keys(model.dynamicParameters ?? {})) {
    const value = nanoVideoParameterArgument(key, args);
    if (value !== undefined) dynamicValues[key] = value;
  }
  let parameters = buildModelParameterPayload(
    model,
    resolveModelParameterValues(model, dynamicValues),
  );
  if (!Object.keys(model.dynamicParameters ?? {}).length) {
    const seconds = toolNumberArgument(args, ["seconds"]);
    const size = toolStringArgument(args, ["size"]);
    const fps = toolNumberArgument(args, ["fps"]);
    const guidance = toolNumberArgument(args, ["guidance_scale_2"]);
    const seed = toolNumberArgument(args, ["seed"]);
    parameters = {
      ...(seconds !== undefined ? { duration: seconds } : {}),
      ...(size
        ? size.includes(":")
          ? { aspect_ratio: size }
          : { resolution: size }
        : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(guidance !== undefined ? { guidance_scale_2: guidance } : {}),
      ...(seed !== undefined ? { seed: Math.round(seed) } : {}),
    };
  }
  const acceptsSourceImage =
    model.supports?.sourceImage === true ||
    model.supports?.imageToVideo === true ||
    (model.supports?.sourceImage !== false &&
      normalizedModalities(model.inputModalities).includes("image"));
  return {
    model: model.id,
    prompt,
    parameters,
    ...(acceptsSourceImage && sourceImage ? { sourceImage } : {}),
  };
};

export const buildChatMediaPreview = ({
  item,
  prompt,
  provider,
}: {
  item: ChatMediaAsset;
  prompt?: string | null;
  provider?: string | null;
}): ChatMediaPreview => ({
  imageUrl: item.dataUrl,
  prompt: prompt?.trim() ?? "",
  model: item.model ?? "",
  provider: provider?.trim() ?? "",
  kind: item.kind,
  mimeType: item.mimeType || null,
});

export const resolveNavyVideoStartResult = (value: unknown) => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    videoUrl:
      typeof record.videoUrl === "string" ? record.videoUrl.trim() : "",
    jobId: typeof record.id === "string" ? record.id.trim() : "",
  };
};
