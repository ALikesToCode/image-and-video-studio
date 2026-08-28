import type { ModelOption, Provider } from "./constants.ts";
import type { ModelParameterValues } from "./model-capability-settings.ts";

const GPT_IMAGE_2_MAX_PIXELS = 3_840 * 2_160;
const GPT_IMAGE_2_MAX_EDGE = 3_840;
// NanoGPT applies a stricter transport cap than the upstream GPT Image 2 API.
const NANOGPT_GPT_IMAGE_2_MAX_EDGE = 2_560;
const IMAGE_DIMENSION_STEP = 16;

type PixelSize = {
  width: number;
  height: number;
};

export type ImageQualityRequest = {
  aspectRatio?: string;
  imageSize?: string;
  size?: string;
  quality?: string;
  resolution?: string;
  width?: number;
  height?: number;
  parameters?: ModelParameterValues;
};

type MaximumImageQualityInput = {
  enabled: boolean;
  provider: Provider;
  model: string;
  modelOption?: ModelOption;
  request: ImageQualityRequest;
};

const normalizedModelId = (model: string) => model.trim().toLowerCase();

const isGptImage2Model = (model: string) =>
  /(?:^|[:/])gpt-image-2(?:$|[-:/])/i.test(model.trim());

const isGptImageModel = (model: string) =>
  /(?:^|[:/])gpt-image-/i.test(model.trim());

const isGemini3ImageModel = (model: string) => {
  const normalized = normalizedModelId(model);
  return normalized.includes("gemini-3") && normalized.includes("image");
};

const isImagenModel = (model: string) =>
  /(?:^|[:/])imagen-/i.test(model.trim());

const parseAspectRatio = (value?: string) => {
  const normalized = value?.trim().toLowerCase() ?? "";
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(normalized);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return Math.min(3, Math.max(1 / 3, width / height));
};

const requestAspectRatio = (request: ImageQualityRequest) => {
  if (parseAspectRatio(request.aspectRatio) !== null) {
    return request.aspectRatio;
  }

  const pixelSize = [request.imageSize, request.size, request.resolution]
    .map((value) => parseImagePixelSize(value))
    .find((value): value is PixelSize => value !== null);
  if (pixelSize) return `${pixelSize.width}:${pixelSize.height}`;

  if (
    Number.isFinite(request.width) &&
    Number.isFinite(request.height) &&
    (request.width ?? 0) > 0 &&
    (request.height ?? 0) > 0
  ) {
    return `${request.width}:${request.height}`;
  }

  return request.aspectRatio;
};

export const parseImagePixelSize = (value?: string): PixelSize | null => {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
};

const resolutionRank = (value: string) => {
  const pixels = parseImagePixelSize(value);
  if (pixels) return pixels.width * pixels.height;

  const kiloPixels = /^(\d+(?:\.\d+)?)k$/i.exec(value.trim());
  if (kiloPixels) {
    const edge = Number(kiloPixels[1]) * 1_024;
    return edge * edge;
  }

  const verticalPixels = /^(\d{3,5})p$/i.exec(value.trim());
  if (verticalPixels) {
    const height = Number(verticalPixels[1]);
    return height * height * (16 / 9);
  }

  return 0;
};

const usableResolution = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !["auto", "default", "model_default"].includes(normalized);
};

export const selectHighestImageResolution = (
  values: string[],
  aspectRatio?: string,
) => {
  const unique = Array.from(
    new Set(values.map((value) => value.trim()).filter(usableResolution)),
  );
  if (!unique.length) return undefined;

  const targetRatio = parseAspectRatio(aspectRatio);
  return unique
    .map((value) => ({
      value,
      pixels: parseImagePixelSize(value),
      rank: resolutionRank(value),
    }))
    .sort((left, right) => {
      const leftRatioDifference =
        targetRatio && left.pixels
          ? Math.abs(
              Math.log(
                left.pixels.width / left.pixels.height / targetRatio,
              ),
            )
          : 0;
      const rightRatioDifference =
        targetRatio && right.pixels
          ? Math.abs(
              Math.log(
                right.pixels.width / right.pixels.height / targetRatio,
              ),
            )
          : 0;
      const ratioDifference = leftRatioDifference - rightRatioDifference;
      if (Math.abs(ratioDifference) > 0.0001) return ratioDifference;
      return right.rank - left.rank;
    })[0]?.value;
};

export const resolveMaximumGptImage2Size = (
  aspectRatio?: string,
  maxEdge = GPT_IMAGE_2_MAX_EDGE,
) => {
  const ratio = parseAspectRatio(aspectRatio) ?? 1;
  const idealWidth = Math.sqrt(GPT_IMAGE_2_MAX_PIXELS * ratio);
  const idealHeight = Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / ratio);
  const scale = Math.min(
    1,
    maxEdge / idealWidth,
    maxEdge / idealHeight,
  );
  let width =
    Math.round((idealWidth * scale) / IMAGE_DIMENSION_STEP) *
    IMAGE_DIMENSION_STEP;
  let height =
    Math.round((idealHeight * scale) / IMAGE_DIMENSION_STEP) *
    IMAGE_DIMENSION_STEP;

  while (width * height > GPT_IMAGE_2_MAX_PIXELS) {
    if (width / height > ratio) width -= IMAGE_DIMENSION_STEP;
    else height -= IMAGE_DIMENSION_STEP;
  }
  return `${width}x${height}`;
};

const standardGptImageSize = (aspectRatio?: string) => {
  const ratio = parseAspectRatio(aspectRatio) ?? 1;
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.87) return "1024x1536";
  return "1024x1024";
};

const normalizedParameterKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

const isSizeParameter = (key: string) => {
  const normalized = normalizedParameterKey(key);
  return (
    normalized === "size" ||
    normalized === "resolution" ||
    normalized === "imagesize" ||
    normalized === "outputsize" ||
    normalized === "outputresolution"
  );
};

const isQualityParameter = (key: string) =>
  normalizedParameterKey(key).includes("quality");

const descriptorStringOptions = (
  descriptor: NonNullable<ModelOption["dynamicParameters"]>[string],
) =>
  (descriptor.options ?? [])
    .map((option) =>
      typeof option.value === "string" ? option.value.trim() : "",
    )
    .filter(Boolean);

const catalogResolutionOptions = (model?: ModelOption) => {
  const values = [...(model?.supportedResolutions ?? [])];
  for (const [key, descriptor] of Object.entries(model?.dynamicParameters ?? {})) {
    if (isSizeParameter(key)) values.push(...descriptorStringOptions(descriptor));
  }
  return values;
};

const qualityRank = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (/^(?:max|maximum|ultra|highest|high|hd)$/.test(normalized)) return 4;
  if (/^(?:medium|standard)$/.test(normalized)) return 3;
  if (/^(?:low|draft)$/.test(normalized)) return 2;
  if (/^(?:auto|default)$/.test(normalized)) return 1;
  return 0;
};

const highestCatalogQuality = (model?: ModelOption) => {
  const values = Object.entries(model?.dynamicParameters ?? {})
    .filter(([key]) => isQualityParameter(key))
    .flatMap(([, descriptor]) => descriptorStringOptions(descriptor));
  return values.sort((left, right) => qualityRank(right) - qualityRank(left))[0];
};

const sizeFieldForProvider = (provider: Provider) => {
  if (provider === "gemini" || provider === "openrouter") return "imageSize";
  if (provider === "nanogpt" || provider === "chutes") return "resolution";
  return "size";
};

const withDynamicMaximums = (
  model: ModelOption | undefined,
  request: ImageQualityRequest,
  resolution?: string,
  quality?: string,
) => {
  const parameters = { ...(request.parameters ?? {}) };
  let changed = false;
  for (const [key, descriptor] of Object.entries(model?.dynamicParameters ?? {})) {
    if (resolution && isSizeParameter(key)) {
      const options = descriptorStringOptions(descriptor);
      if (!options.length || options.includes(resolution)) {
        parameters[key] = resolution;
        changed = true;
      }
    }
    if (quality && isQualityParameter(key)) {
      const options = descriptorStringOptions(descriptor);
      if (!options.length || options.includes(quality)) {
        parameters[key] = quality;
        changed = true;
      }
    }
  }
  return changed || request.parameters
    ? { ...request, parameters }
    : request;
};

export const resolveMaximumImageQualityRequest = ({
  enabled,
  provider,
  model,
  modelOption,
  request,
}: MaximumImageQualityInput): ImageQualityRequest => {
  if (!enabled) return { ...request };

  const aspectRatio = requestAspectRatio(request);
  let resolution: string | undefined;
  let quality: string | undefined;
  if (isGptImage2Model(model)) {
    const nanoGptTransport =
      provider === "nanogpt" || normalizedModelId(model).startsWith("nanogpt:");
    resolution = resolveMaximumGptImage2Size(
      aspectRatio,
      nanoGptTransport ? NANOGPT_GPT_IMAGE_2_MAX_EDGE : GPT_IMAGE_2_MAX_EDGE,
    );
    quality = "high";
  } else if (isGptImageModel(model)) {
    resolution = standardGptImageSize(aspectRatio);
    quality = "high";
  } else if (isImagenModel(model)) {
    resolution = "2K";
  } else if (isGemini3ImageModel(model)) {
    resolution = "4K";
  } else {
    resolution = selectHighestImageResolution(
      catalogResolutionOptions(modelOption),
      aspectRatio,
    );
    quality = highestCatalogQuality(modelOption);
  }

  if ((provider === "navy" || provider === "multillm") && !quality) {
    quality = "high";
  }

  let resolved = withDynamicMaximums(
    modelOption,
    { ...request },
    resolution,
    quality,
  );
  if (resolution) {
    const field = sizeFieldForProvider(provider);
    resolved = { ...resolved, [field]: resolution };
    if (provider === "chutes") {
      const pixels = parseImagePixelSize(resolution);
      if (pixels) {
        resolved.width = pixels.width;
        resolved.height = pixels.height;
      }
    }
  }
  if (quality) resolved.quality = quality;
  return resolved;
};

export const describeImageQualityRequest = (request: ImageQualityRequest) => {
  const size = [request.imageSize, request.size, request.resolution].find(
    (value): value is string => typeof value === "string" && usableResolution(value),
  ) ?? (request.width && request.height
    ? `${request.width}x${request.height}`
    : "");
  const quality =
    request.quality && usableResolution(request.quality)
      ? request.quality
      : "";
  if (size && quality) return `${size} · ${quality}`;
  return size || quality || "Model maximum";
};
