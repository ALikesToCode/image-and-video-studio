import {
  AUTO_IMAGE_OPTION,
  type ModelOption,
  type Provider,
} from "./constants.ts";
import type { GeneratedImage } from "./types.ts";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import {
  appendImagePromptDirective,
  normalizeImagePromptAgeDescriptors,
  normalizeImagePromptWhitespace,
} from "./image-prompt-language.ts";
import {
  isGeminiNativeImageModel,
  isOpenAiImageModel,
  preparePolicyImagePromptForModel,
} from "./image-prompt-policy.ts";
import { normalizeImageReferencePayload } from "./media-reference.ts";
import {
  IMAGE_MIME_TYPES,
  dataUrlToInlineData,
  normalizeVeoDuration,
  parseDataUrl,
} from "./studio-validation.ts";

export {
  areImagePromptsEquivalent,
  buildImagePolicyRecoveryPrompt,
  buildImagePromptHelpRequest,
  buildImageRetryFallbackPrompt,
  buildProviderPolicyHintForImageModels,
  buildSaferImagePromptForModel,
  extractImagePolicyViolationCategories,
  isLikelyImagePolicyError,
  normalizeImagePromptHelpModel,
  resolveImagePromptHelpChatModels,
  resolveImagePromptRecoveryChatModels,
  supportsSaferImagePromptRetry,
  type ImagePromptHelpModel,
} from "./image-prompt-policy.ts";

export {
  DEFAULT_IMAGE_RETRY_ATTEMPTS,
  MAX_IMAGE_RETRY_ATTEMPTS,
  normalizeImageRetryAttempts,
  retryAsyncOperation,
} from "./image-retry.ts";

type ActiveJobLike = {
  status: "queued" | "running" | "success" | "error";
};

type NavyImageGenerationInput = {
  model: string;
  prompt: string;
  size?: string;
  numberOfImages?: number;
  quality?: string;
  style?: string;
  imageUrl?: string | string[];
  negativePrompt?: string;
  seed?: number | null;
  seconds?: number;
  sync?: boolean;
  responseFormat?: string;
  aspectRatio?: string;
};

type NavyModelGroups = {
  data: ModelOption[];
  chat: ModelOption[];
  image: ModelOption[];
  video: ModelOption[];
  audio: ModelOption[];
};

type ReferenceImageInput = {
  dataUrl: string;
  role?: string;
};

type SanitizedReferenceImage = {
  dataUrl: string;
  data: string;
  mimeType: string;
  role?: string;
};

type QueueMode = "image" | "video" | "tts";

type QueueJobLike = {
  id: string;
  status: "queued" | "running" | "success" | "error";
  mode: QueueMode;
};

type ImageSizingOptionsInput = {
  imageAspect?: string;
  imageSize?: string;
  navyImageSize?: string;
};

type ImageSizingOptions = {
  aspectRatio?: string;
  imageSize?: string;
  size?: string;
};

type NavyChatImageSizing = {
  aspectRatio?: string;
  size?: string;
};

export const NAVY_JOB_POLL_INTERVAL_MS = 5000;
export const NAVY_JOB_POLL_MAX_ATTEMPTS = 120;
const NAVY_JOB_POLL_MAX_DELAY_MS = 30000;

const clampNavyPollDelayMs = (value: number) =>
  Math.min(Math.max(Math.round(value), 1000), NAVY_JOB_POLL_MAX_DELAY_MS);

export const resolveNavyJobPollDelayMs = ({
  payload,
  responseStatus,
  currentDelayMs,
}: {
  payload: unknown;
  responseStatus: number;
  currentDelayMs: number;
}) => {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  if (
    typeof record.retryAfterMs === "number" &&
    Number.isFinite(record.retryAfterMs)
  ) {
    return clampNavyPollDelayMs(record.retryAfterMs);
  }
  if (responseStatus === 429 || record.status === "rate_limited") {
    return clampNavyPollDelayMs(currentDelayMs * 2);
  }
  return NAVY_JOB_POLL_INTERVAL_MS;
};

const normalizeModalities = (modalities?: string[] | null) =>
  (modalities ?? []).map((value) => value.toLowerCase());

const normalizeEndpoint = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : "";

const normalizeWhitespace = normalizeImagePromptWhitespace;

const ensureSentence = (value: string) => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const appendPromptNote = appendImagePromptDirective;

const isAutoImageOption = (value?: string) =>
  !value || value === AUTO_IMAGE_OPTION;

const toSectionTitle = (rawLabel: string) => {
  const normalized = rawLabel.trim().toLowerCase();
  if (normalized === "background/setting") return "Background and setting";
  if (normalized === "main character (focus)") return "Main character";
  if (normalized === "hair & makeup") return "Hair and makeup";
  if (normalized === "pose/expression") return "Pose and expression";
  if (normalized === "composition/camera") return "Composition and camera";
  return rawLabel
    .replace(/[()]/g, "")
    .replace(/[/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const NEGATIVE_PROMPT_UPGRADES: Array<[RegExp, string]> = [
  [/\b(blurry|blur|soft focus)\b/i, "sharp focus and crisp detail"],
  [
    /\b(text|caption|lettering|watermark|logo|signature)\b/i,
    "clean surfaces without embedded typography or branding",
  ],
  [
    /\b(extra limbs|extra fingers|bad hands|bad anatomy|deformed)\b/i,
    "coherent anatomy with natural hands and accurate proportions",
  ],
  [
    /\b(low quality|artifact|artifacts|noise|grainy|muddy)\b/i,
    "polished, artifact-free rendering with high clarity",
  ],
];

const NAVY_IMAGE_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
  "4:5",
  "5:4",
  "auto",
  "match_input_image",
  "custom",
]);
const NAVY_IMAGE_PIXEL_SIZES = new Set(["1024x1024", "512x512", "768x768"]);
const NAVY_IMAGE_PIXEL_SIZE_PATTERN = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/i;

const parseNavyImagePixelSize = (value: string) => {
  const match = NAVY_IMAGE_PIXEL_SIZE_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
};

export const isGptImage2Model = (model: string) =>
  model.trim().toLowerCase() === "gpt-image-2";

export const isValidNavyImagePixelSize = (value: string) =>
  Boolean(parseNavyImagePixelSize(value));

export const isValidGptImage2Size = (value: string) => {
  if (isAutoImageOption(value)) return true;
  const parsed = parseNavyImagePixelSize(value);
  if (!parsed) return false;
  const { width, height } = parsed;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;
  return (
    longEdge <= 3840 &&
    width % 16 === 0 &&
    height % 16 === 0 &&
    longEdge / shortEdge <= 3 &&
    totalPixels >= 655_360 &&
    totalPixels <= 8_294_400
  );
};

export const isImagenModel = (model: string) => model.startsWith("imagen-");

const isOpenAiGptImageModel = (model: string) =>
  /\bgpt-image-/i.test(model.trim());

const NAVY_GPT_IMAGE_ASPECT_RATIO_SIZES: Record<string, string> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

const isOpenAiDallEImageModel = (model: string) =>
  /\bdall-e-/i.test(model.trim());

const isDallE3ImageModel = (model: string) =>
  /(?:^|[/:])dall-e-3$/i.test(model.trim());

const supportsImageStyleParameter = (model: string) => {
  if (isOpenAiGptImageModel(model)) return false;
  if (isOpenAiDallEImageModel(model)) return isDallE3ImageModel(model);
  return true;
};

const sanitizeImageRequestBodyForModel = <T extends Record<string, unknown>>(
  model: string,
  body: T,
): T => {
  if (supportsImageStyleParameter(model)) return body;
  const sanitized = { ...body };
  delete sanitized.style;
  return sanitized;
};

const buildFluxQualityGuidance = (negativePrompt?: string) => {
  const positiveTargets = new Set<string>([
    "crisp fine details",
    "coherent anatomy",
    "readable silhouettes",
    "polished surfaces",
    "artifact-free rendering",
  ]);

  if (negativePrompt?.trim()) {
    for (const [pattern, upgrade] of NEGATIVE_PROMPT_UPGRADES) {
      if (pattern.test(negativePrompt)) {
        positiveTargets.add(upgrade);
      }
    }
  }

  return `Desired qualities: ${Array.from(positiveTargets).join(", ")}.`;
};

const isPreparedFluxPrompt = (prompt: string) =>
  /\bDesired qualities:\s*/i.test(prompt) &&
  /\b(crisp fine details|coherent anatomy|artifact-free rendering)\b/i.test(
    prompt,
  );

export const buildFluxImagePrompt = (
  prompt: string,
  negativePrompt?: string,
) => {
  const normalized = normalizeWhitespace(prompt);
  if (!normalized) return buildFluxQualityGuidance(negativePrompt);

  const sections = normalized
    .split("\n")
    .map((line, index) => {
      const match = /^([A-Za-z][A-Za-z0-9/&() \-]+):(.*)$/.exec(line);
      if (!match) {
        const trimmed = line.trim();
        if (index === 0) {
          return ensureSentence(
            `Artwork direction: ${trimmed.replace(/^create\s+/i, "").trim()}`,
          );
        }
        return ensureSentence(trimmed);
      }

      const [, rawLabel, rawValue] = match;
      const value = rawValue.trim();
      if (!value) return "";
      return ensureSentence(`${toSectionTitle(rawLabel)}: ${value}`);
    })
    .filter(Boolean);

  sections.push(buildFluxQualityGuidance(negativePrompt));
  return sections.join("\n\n");
};

export const prepareImagePromptForModel = (
  model: string,
  prompt: string,
  negativePrompt?: string,
) => {
  const rawPrompt = prompt.trim().replace(/\r\n/g, "\n");
  const semanticRawPrompt = normalizeImagePromptAgeDescriptors(rawPrompt);
  const preparedPrompt = preparePolicyImagePromptForModel(model, prompt);
  const trimmedNegativePrompt = negativePrompt?.trim() || undefined;

  if (isOpenAiImageModel(model) || isGeminiNativeImageModel(model)) {
    return {
      prompt: preparedPrompt,
      negativePrompt: trimmedNegativePrompt,
    };
  }

  if (!isFluxModel(model)) {
    return {
      prompt: preparedPrompt,
      negativePrompt: trimmedNegativePrompt,
    };
  }

  const fluxPrompt = isPreparedFluxPrompt(semanticRawPrompt)
    ? semanticRawPrompt
    : buildFluxImagePrompt(preparedPrompt, trimmedNegativePrompt);
  return {
    prompt: fluxPrompt,
    negativePrompt: undefined,
  };
};

export type PreparedImageModelRequest = {
  model: string;
  body: Record<string, unknown>;
  prompt: string;
};

export const prepareImageModelRequests = ({
  models,
  baseBody,
  prompt,
  negativePrompt,
  includeNegativePrompt = true,
}: {
  models: string[];
  baseBody: Record<string, unknown>;
  prompt: string;
  negativePrompt?: string;
  includeNegativePrompt?: boolean;
}): PreparedImageModelRequest[] =>
  models.map((model) => {
    const prepared = prepareImagePromptForModel(model, prompt, negativePrompt);
    return {
      model,
      prompt: prepared.prompt,
      body: sanitizeImageRequestBodyForModel(model, {
        ...baseBody,
        model,
        prompt: prepared.prompt,
        ...(includeNegativePrompt && prepared.negativePrompt
          ? { negativePrompt: prepared.negativePrompt }
          : {}),
      }),
    };
  });

export const summarizeImageModelPrompts = (
  requests: Pick<PreparedImageModelRequest, "model" | "prompt">[],
) => {
  const uniquePrompts = Array.from(
    new Set(requests.map((request) => request.prompt).filter(Boolean)),
  );
  if (uniquePrompts.length <= 1) {
    return uniquePrompts[0] ?? "";
  }
  return requests
    .map((request) => `${request.model}:\n${request.prompt}`)
    .join("\n\n");
};

export const resolveImageSizingOptions = (
  provider: Provider,
  { imageAspect, imageSize, navyImageSize }: ImageSizingOptionsInput,
): ImageSizingOptions => {
  const sizing: ImageSizingOptions = {};

  if (
    (provider === "gemini" ||
      provider === "openrouter" ||
      provider === "navy" ||
      provider === "multillm") &&
    !isAutoImageOption(imageAspect)
  ) {
    sizing.aspectRatio = imageAspect;
  }

  if (
    (provider === "gemini" || provider === "openrouter") &&
    !isAutoImageOption(imageSize)
  ) {
    sizing.imageSize = imageSize;
  }

  if (
    (provider === "navy" || provider === "multillm") &&
    !isAutoImageOption(navyImageSize)
  ) {
    sizing.size = navyImageSize;
  }

  return sizing;
};

export const resolveNavyChatImageSizing = (
  value: string,
): NavyChatImageSizing => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return {};
  if (NAVY_IMAGE_ASPECT_RATIOS.has(normalized)) {
    return { aspectRatio: normalized };
  }
  if (
    NAVY_IMAGE_PIXEL_SIZES.has(normalized) ||
    isValidNavyImagePixelSize(normalized)
  ) {
    return { size: normalized };
  }
  return {};
};

const sanitizeReferenceImages = (
  referenceImages?: ReferenceImageInput[],
  maxItems = 10,
): SanitizedReferenceImage[] =>
  (referenceImages ?? [])
    .map<SanitizedReferenceImage | null>((reference) => {
      const parsed = parseDataUrl(reference.dataUrl, IMAGE_MIME_TYPES);
      if (!parsed) return null;
      return {
        dataUrl: parsed.dataUrl,
        data: parsed.data,
        mimeType: parsed.mimeType,
        ...(reference.role ? { role: reference.role } : {}),
      };
    })
    .filter(
      (reference): reference is SanitizedReferenceImage => reference !== null,
    )
    .slice(0, maxItems);

export const buildGeminiImagePayload = ({
  model,
  prompt,
  aspectRatio,
  imageSize,
  numberOfImages,
  referenceImages,
}: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  numberOfImages?: number;
  referenceImages?: ReferenceImageInput[];
}) => {
  const preparedPrompt = prepareImagePromptForModel(model, prompt);

  if (isImagenModel(model)) {
    return {
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
      payload: {
        instances: [{ prompt: preparedPrompt.prompt }],
        parameters: {
          sampleCount: numberOfImages ?? 1,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(imageSize ? { imageSize } : {}),
        },
      },
    };
  }

  const parts: Array<Record<string, unknown>> = [
    { text: preparedPrompt.prompt },
  ];
  for (const reference of sanitizeReferenceImages(referenceImages)) {
    parts.push({
      inline_data: {
        mime_type: reference.mimeType,
        data: reference.data,
      },
    });
  }

  return {
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    payload: {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(aspectRatio || imageSize
          ? {
              imageConfig: {
                ...(aspectRatio ? { aspectRatio } : {}),
                ...(imageSize ? { imageSize } : {}),
              },
            }
          : {}),
      },
    },
  };
};

export const buildOpenRouterImagePayload = ({
  model,
  prompt,
  aspectRatio,
  imageSize,
  outputModalities,
  referenceImages,
}: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  outputModalities?: string[];
  referenceImages?: ReferenceImageInput[];
}) => {
  const modalities = resolveOpenRouterModalities(model, outputModalities);
  const preparedPrompt = prepareImagePromptForModel(model, prompt);
  const references = sanitizeReferenceImages(referenceImages);
  const content = references.length
    ? [
        { type: "text", text: preparedPrompt.prompt },
        ...references.map((reference) => ({
          type: "image_url",
          image_url: { url: reference.dataUrl },
        })),
      ]
    : preparedPrompt.prompt;

  return {
    model,
    messages: [{ role: "user", content }],
    modalities,
    ...(aspectRatio || imageSize
      ? {
          image_config: {
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(imageSize ? { image_size: imageSize } : {}),
          },
        }
      : {}),
  };
};

const toVeoInlineImage = (dataUrl?: string | null) => {
  if (!dataUrl) return null;
  const inlineData = dataUrlToInlineData(dataUrl);
  if (!inlineData) return null;
  return {
    inlineData: {
      mimeType: inlineData.inlineData.mimeType,
      data: inlineData.inlineData.data,
    },
  };
};

export const buildGeminiVideoPayload = ({
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
  negativePrompt,
  sourceImage,
  lastFrameImage,
  referenceImages,
}: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: string;
  negativePrompt?: string;
  sourceImage?: string | null;
  lastFrameImage?: string | null;
  referenceImages?: ReferenceImageInput[];
}) => {
  const image = toVeoInlineImage(sourceImage);
  const lastFrame = toVeoInlineImage(lastFrameImage);
  const referenceImageParts = sanitizeReferenceImages(referenceImages, 3)
    .filter(
      (reference) =>
        reference.role !== "source_image" &&
        reference.role !== "first_frame" &&
        reference.role !== "last_frame",
    )
    .slice(0, 3)
    .map((reference) => ({
      image: {
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.data,
        },
      },
      referenceType: reference.role === "style" ? "style" : "asset",
    }));
  const normalizedDuration = normalizeVeoDuration(durationSeconds, {
    resolution,
    hasReferenceImages: referenceImageParts.length > 0,
    hasLastFrame: Boolean(lastFrame),
  });

  return {
    instances: [
      {
        prompt,
        ...(image ? { image } : {}),
        ...(lastFrame ? { lastFrame } : {}),
        ...(referenceImageParts.length
          ? { referenceImages: referenceImageParts }
          : {}),
      },
    ],
    parameters: {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      durationSeconds: normalizedDuration,
      ...(negativePrompt ? { negativePrompt } : {}),
    },
  };
};

export const getActiveJobCount = (jobs: ActiveJobLike[]) =>
  jobs.filter((job) => job.status === "queued" || job.status === "running")
    .length;

export const isFluxModel = (model: string) =>
  /(^|[/:.-])flux([/:.-]|$)/i.test(model);

export const resolveOpenRouterModalities = (
  model: string,
  outputModalities?: string[],
) => {
  const normalized = normalizeModalities(outputModalities);
  if (normalized.includes("image") && !normalized.includes("text")) {
    return ["image"];
  }
  if (normalized.includes("image") && normalized.includes("text")) {
    return ["image", "text"];
  }
  return isFluxModel(model) ? ["image"] : ["image", "text"];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const firstPresent = (...values: unknown[]) =>
  values.find((value) => value !== undefined);

const nullableNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : value === null
      ? null
      : undefined;

const nullableBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : value === null ? null : undefined;

const nullableString = (value: unknown) =>
  typeof value === "string" ? value : value === null ? null : undefined;

const nullableStringArray = (value: unknown) => {
  if (value === null) return null;
  const values = asArray(value).filter(
    (entry): entry is string => typeof entry === "string",
  );
  return values.length ? values : undefined;
};

const setNullable = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (value !== undefined) {
    target[key] = value;
  }
};

const pushUniqueModel = (list: ModelOption[], model: ModelOption) => {
  if (!list.some((entry) => entry.id === model.id)) {
    list.push(model);
  }
};

const NAVY_VIDEO_MODEL_PATTERN =
  /\b(veo|cogvideo|kling|hunyuan|wan|minimax|luma|runway|video)\b/i;
const NAVY_TTS_MODEL_PATTERN =
  /(^|[/:._-])(tts|eleven|voice)([/:._-]|$)|gemini-.*tts/i;
const NAVY_TRANSCRIPTION_MODEL_PATTERN = /\b(whisper|transcribe|scribe)\b/i;

type NavyMediaKind = "image" | "video";

type NavyMediaCapabilityProfile = {
  maxReferenceImages: number;
  supports: NonNullable<ModelOption["supports"]>;
};

const NAVY_MEDIA_CAPABILITY_PROFILES: Record<
  string,
  NavyMediaCapabilityProfile
> = {
  flux: {
    maxReferenceImages: 3,
    supports: {
      imageEdit: true,
      sourceImage: true,
      referenceImages: true,
      aspectRatio: true,
    },
  },
  "flux.2-klein": {
    maxReferenceImages: 3,
    supports: {
      imageEdit: true,
      sourceImage: true,
      referenceImages: true,
      aspectRatio: true,
    },
  },
  "grok-imagine": {
    maxReferenceImages: 1,
    supports: {
      imageEdit: true,
      sourceImage: true,
      referenceImages: true,
      aspectRatio: true,
    },
  },
  "z-image": {
    maxReferenceImages: 0,
    supports: {
      sourceImage: false,
      referenceImages: false,
      aspectRatio: true,
    },
  },
  "veo-3.1": {
    maxReferenceImages: 3,
    supports: {
      sourceImage: true,
      referenceImages: true,
      aspectRatio: true,
      negativePrompt: true,
      seed: true,
    },
  },
};

const withNavyMediaCapabilities = (
  model: ModelOption,
  kind: NavyMediaKind,
): ModelOption => {
  const metadataIsKnown = model.metadataStatus?.toLowerCase() === "known";
  const profile = metadataIsKnown
    ? NAVY_MEDIA_CAPABILITY_PROFILES[model.id.toLowerCase()]
    : undefined;
  const inputModalities = normalizeModalities(model.inputModalities);
  const acceptsImageInput = inputModalities.includes("image");
  const normalizedEndpoint = normalizeEndpoint(model.endpoint);
  const usesAsyncJobs =
    normalizedEndpoint.includes("/images/generations") ||
    normalizedEndpoint === "navy-images-generations";

  return {
    ...model,
    supports: {
      ...(model.supports ?? {}),
      ...(kind === "video"
        ? { video: true, asyncJobs: true }
        : {
            imageGeneration: true,
            size: true,
            aspectRatio: true,
            ...(usesAsyncJobs ? { asyncJobs: true } : {}),
            ...(acceptsImageInput
              ? {
                  imageEdit: true,
                  sourceImage: true,
                  referenceImages: true,
                }
              : {}),
          }),
      ...(profile?.supports ?? {}),
    },
    ...(profile
      ? { maxReferenceImages: profile.maxReferenceImages }
      : acceptsImageInput
        ? { maxReferenceImages: 5 }
        : {}),
  };
};

const toModelOption = (value: unknown): ModelOption | null => {
  const record = asRecord(value);
  if (!record) return null;

  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;

  const label =
    typeof record.name === "string"
      ? record.name
      : typeof record.label === "string"
        ? record.label
        : id;
  const architecture = asRecord(record.architecture);
  const outputModalities = nullableStringArray(
    firstPresent(
      record.output_modalities,
      record.outputModalities,
      architecture?.output_modalities,
    ),
  );
  const inputModalities = nullableStringArray(
    firstPresent(
      record.input_modalities,
      record.inputModalities,
      architecture?.input_modalities,
    ),
  );
  const endpoint =
    typeof record.endpoint === "string" ? record.endpoint : undefined;
  const provider =
    typeof record.owned_by === "string"
      ? record.owned_by
      : typeof record.provider === "string"
        ? record.provider
        : undefined;
  const premium =
    typeof record.premium === "boolean" ? record.premium : undefined;
  const requiredPlan =
    typeof record.required_plan === "string"
      ? record.required_plan
      : typeof record.requiredPlan === "string"
        ? record.requiredPlan
        : record.required_plan === null || record.requiredPlan === null
          ? null
          : undefined;
  const tokenMultiplier =
    typeof record.token_multiplier === "number"
      ? record.token_multiplier
      : typeof record.tokenMultiplier === "number"
        ? record.tokenMultiplier
        : undefined;
  const pricing = record.pricing;
  const contextWindow = nullableNumber(
    firstPresent(record.context_window, record.contextWindow),
  );
  const maxOutputTokens = nullableNumber(
    firstPresent(record.max_output_tokens, record.maxOutputTokens),
  );
  const modality = nullableString(record.modality);
  const tokenizer = nullableString(record.tokenizer);
  const description = nullableString(record.description);
  const metadataSource = nullableString(
    firstPresent(record.metadata_source, record.metadataSource),
  );
  const metadataStatus =
    typeof record.metadata_status === "string"
      ? record.metadata_status
      : typeof record.metadataStatus === "string"
        ? record.metadataStatus
        : undefined;
  const supportsVision = nullableBoolean(
    firstPresent(record.supports_vision, record.supportsVision),
  );
  const supportsTools = nullableBoolean(
    firstPresent(record.supports_tools, record.supportsTools),
  );
  const supportsFunctionCalling = nullableBoolean(
    firstPresent(
      record.supports_function_calling,
      record.supportsFunctionCalling,
    ),
  );
  const supportsReasoning = nullableBoolean(
    firstPresent(record.supports_reasoning, record.supportsReasoning),
  );
  const supportsJsonMode = nullableBoolean(
    firstPresent(record.supports_json_mode, record.supportsJsonMode),
  );
  const supportsAudioInput = nullableBoolean(
    firstPresent(record.supports_audio_input, record.supportsAudioInput),
  );
  const supportsImageOutput = nullableBoolean(
    firstPresent(record.supports_image_output, record.supportsImageOutput),
  );
  const supportsStreaming = nullableBoolean(
    firstPresent(record.supports_streaming, record.supportsStreaming),
  );

  const model: ModelOption & Record<string, unknown> = {
    id,
    label,
    ...(provider ? { provider } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(endpoint ? { upstreamEndpoint: endpoint } : {}),
    ...(provider ? { upstreamOwner: provider } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
    ...(outputModalities !== undefined ? { outputModalities } : {}),
    ...(typeof premium === "boolean" ? { premium } : {}),
    ...(requiredPlan !== undefined ? { requiredPlan } : {}),
    ...(typeof tokenMultiplier === "number" ? { tokenMultiplier } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
  };

  setNullable(model, "contextWindow", contextWindow);
  setNullable(model, "maxOutputTokens", maxOutputTokens);
  setNullable(model, "modality", modality);
  setNullable(model, "tokenizer", tokenizer);
  setNullable(model, "description", description);
  setNullable(model, "metadataSource", metadataSource);
  setNullable(model, "metadataStatus", metadataStatus);
  setNullable(model, "supportsVision", supportsVision);
  setNullable(model, "supportsTools", supportsTools);
  setNullable(model, "supportsFunctionCalling", supportsFunctionCalling);
  setNullable(model, "supportsReasoning", supportsReasoning);
  setNullable(model, "supportsJsonMode", supportsJsonMode);
  setNullable(model, "supportsAudioInput", supportsAudioInput);
  setNullable(model, "supportsImageOutput", supportsImageOutput);
  setNullable(model, "supportsStreaming", supportsStreaming);

  return model;
};

export const extractOpenRouterImageModels = (
  payload: unknown,
): ModelOption[] => {
  const rawModels = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.data);

  return rawModels.map(toModelOption).filter((entry): entry is ModelOption => {
    if (!entry) return false;
    const modalities = normalizeModalities(entry.outputModalities);
    if (!modalities.length) return true;
    return modalities.includes("image");
  });
};

export const groupNavyModelsByCapability = (
  payload: unknown,
): NavyModelGroups => {
  const rawModels = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.data ?? payload);

  return rawModels.reduce<NavyModelGroups>(
    (groups, entry) => {
      const record = asRecord(entry);
      const model = toModelOption(entry);
      if (!record || !model) return groups;
      pushUniqueModel(groups.data, model);

      const endpoint = normalizeEndpoint(record.endpoint);
      const id = model.id.toLowerCase();
      const outputModalities = normalizeModalities(model.outputModalities);

      const usesChatCompletions = endpoint.includes("/v1/chat/completions");
      if (
        endpoint.includes("/v1/chat/completions") ||
        endpoint.includes("/v1/messages") ||
        endpoint.includes("/v1/responses")
      ) {
        pushUniqueModel(groups.chat, {
          ...model,
          supports: { ...(model.supports ?? {}) },
        });
        if (
          usesChatCompletions &&
          (outputModalities.includes("image") ||
            model.supportsImageOutput === true)
        ) {
          pushUniqueModel(
            groups.image,
            withNavyMediaCapabilities(model, "image"),
          );
        }
        return groups;
      }

      if (
        endpoint.includes("/v1/audio/speech") ||
        (!endpoint &&
          NAVY_TTS_MODEL_PATTERN.test(id) &&
          !NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id))
      ) {
        pushUniqueModel(groups.audio, {
          ...model,
          supports: { ...(model.supports ?? {}), tts: true },
        });
        return groups;
      }

      const usesVideoEndpoint =
        endpoint.includes("/v1/videos/generations") ||
        endpoint.includes("/videos/generations");
      const usesImageEndpoint =
        endpoint.includes("/v1/images/generations") ||
        endpoint.includes("/images/generations");

      if (usesVideoEndpoint || usesImageEndpoint || !endpoint) {
        const mediaKind: NavyMediaKind = outputModalities.includes("video")
          ? "video"
          : outputModalities.includes("image")
            ? "image"
            : usesVideoEndpoint || NAVY_VIDEO_MODEL_PATTERN.test(id)
              ? "video"
              : "image";

        if (!NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id)) {
          pushUniqueModel(
            groups[mediaKind],
            withNavyMediaCapabilities(model, mediaKind),
          );
        }
      }

      return groups;
    },
    { data: [], chat: [], image: [], video: [], audio: [] },
  );
};

export const resolveImageGenerationModelPipeline = (
  preferredModels: string[],
  fallbackModel: string,
  availableModels: string[],
) => {
  const allowed = new Set(availableModels);
  const ordered: string[] = [];

  for (const model of preferredModels) {
    if (!allowed.has(model) || ordered.includes(model)) continue;
    ordered.push(model);
  }

  if (!ordered.length && allowed.has(fallbackModel)) {
    ordered.push(fallbackModel);
  }

  return ordered;
};

export const normalizeImageModelOrder = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const order: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const model = value.trim();
    if (!model || order.includes(model)) continue;
    order.push(model);
  }

  return order;
};

export const resolveActiveImageToolModels = ({
  pipelineEnabled,
  preferredModels,
  fallbackModel,
  availableModels,
}: {
  pipelineEnabled: boolean;
  preferredModels: string[];
  fallbackModel: string;
  availableModels: string[];
}) =>
  resolveImageGenerationModelPipeline(
    pipelineEnabled ? preferredModels : [],
    fallbackModel,
    availableModels,
  );

export const getQueuedJobsToStart = (
  jobs: QueueJobLike[],
  {
    maxConcurrentImageJobs = 3,
    maxConcurrentNonImageJobs = 1,
    activeIds = [],
  }: {
    maxConcurrentImageJobs?: number;
    maxConcurrentNonImageJobs?: number;
    activeIds?: string[];
  } = {},
) => {
  const activeSet = new Set(activeIds);
  let availableImageSlots =
    maxConcurrentImageJobs -
    jobs.filter((job) => job.status === "running" && job.mode === "image")
      .length;
  let availableNonImageSlots =
    maxConcurrentNonImageJobs -
    jobs.filter((job) => job.status === "running" && job.mode !== "image")
      .length;

  const nextJobs: QueueJobLike[] = [];

  for (const job of jobs) {
    if (job.status !== "queued" || activeSet.has(job.id)) continue;

    if (job.mode === "image") {
      if (availableImageSlots <= 0) continue;
      nextJobs.push(job);
      availableImageSlots -= 1;
      continue;
    }

    if (availableNonImageSlots <= 0) continue;
    nextJobs.push(job);
    availableNonImageSlots -= 1;
  }

  return nextJobs;
};

export const mergeGeneratedImagesInDisplayOrder = (
  existing: GeneratedImage[],
  incoming: GeneratedImage[],
) =>
  [...existing, ...incoming].sort((left, right) => {
    const batchDateCompare = (
      left.batchCreatedAt ??
      left.createdAt ??
      ""
    ).localeCompare(right.batchCreatedAt ?? right.createdAt ?? "");
    if (batchDateCompare !== 0) return batchDateCompare;

    const batchOrderCompare =
      (left.batchOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.batchOrder ?? Number.MAX_SAFE_INTEGER);
    if (batchOrderCompare !== 0) return batchOrderCompare;

    const imageOrderCompare =
      (left.imageOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.imageOrder ?? Number.MAX_SAFE_INTEGER);
    if (imageOrderCompare !== 0) return imageOrderCompare;

    return left.id.localeCompare(right.id);
  });

export const normalizeNavyImageUrlPayload = normalizeImageReferencePayload;

export const buildNavyImageGenerationPayload = ({
  model,
  prompt,
  size,
  quality,
  style,
  imageUrl,
  negativePrompt,
  seed,
  seconds,
  sync,
  responseFormat,
  aspectRatio,
}: NavyImageGenerationInput) => {
  const preparedPrompt = prepareImagePromptForModel(
    model,
    prompt,
    negativePrompt,
  );
  const promptWithNegativeGuidance = preparedPrompt.negativePrompt
    ? appendPromptNote(
        preparedPrompt.prompt,
        `Avoid these visual issues: ${preparedPrompt.negativePrompt}.`,
      )
    : preparedPrompt.prompt;
  const normalizedImageUrl = normalizeNavyImageUrlPayload(imageUrl);
  const normalizedSize =
    typeof size === "string" ? size.trim().toLowerCase() : "";
  const explicitSize = isAutoImageOption(normalizedSize) ? "" : normalizedSize;
  const normalizedAspectRatio =
    typeof aspectRatio === "string" ? aspectRatio.trim().toLowerCase() : "";
  const gptImageModel = isOpenAiGptImageModel(model);
  const mappedGptImageSize =
    gptImageModel && !explicitSize
      ? NAVY_GPT_IMAGE_ASPECT_RATIO_SIZES[normalizedAspectRatio]
      : undefined;
  const payloadSize = explicitSize || mappedGptImageSize;
  const normalizedQuality =
    typeof quality === "string" ? quality.trim().toLowerCase() : "";
  const shouldPreferAspectRatio =
    !gptImageModel &&
    !isAutoImageOption(normalizedAspectRatio) &&
    normalizedAspectRatio !== "1:1";

  return sanitizeImageRequestBodyForModel(model, {
    model,
    prompt: promptWithNegativeGuidance,
    ...(payloadSize ? { size: payloadSize } : {}),
    ...(!isAutoImageOption(normalizedQuality)
      ? { quality: normalizedQuality }
      : {}),
    ...(style ? { style } : {}),
    ...(normalizedImageUrl ? { image_url: normalizedImageUrl } : {}),
    ...(typeof seed === "number" ? { seed } : {}),
    ...(typeof seconds === "number" ? { seconds } : {}),
    ...(typeof sync === "boolean" ? { sync } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(!payloadSize && shouldPreferAspectRatio
      ? { aspect_ratio: normalizedAspectRatio }
      : {}),
  });
};

export const isNavyGenerationPending = (status?: string | null) => {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return [
    "queued",
    "pending",
    "processing",
    "running",
    "submitted",
    "in_progress",
  ].includes(normalized);
};

export const isNavyGenerationFailed = (status: unknown) =>
  typeof status === "string" &&
  /^(failed|failure|error|errored|cancelled|canceled)$/i.test(status.trim());

export const buildChutesChatSystemPrompt = ({
  toolImageModel,
  imageModels,
}: {
  toolImageModel: string;
  imageModels: Pick<ModelOption, "id" | "label">[];
}) => {
  const modelList = imageModels.map((item) => item.id).join(", ");

  return `${CHUTES_IMAGE_GUIDE_PROMPT}

You are an image generation assistant.

Rules:
- If the user explicitly asks to generate, create, render, or make an image and the request is specific enough, call generate_image.
- If the request is missing essential details, ask one short clarification question instead of guessing.
- Use the default image model unless the user asks for a specific model.
- When calling generate_image, always include a prompt string.
- Do not include a model in generate_image arguments unless the user explicitly asks for that exact model.
- For FLUX-style models, avoid negative prompts and rewrite exclusions as positive visual instructions.
- After the tool returns, briefly confirm what was generated and keep the response concise.

Default image model: ${toolImageModel}.
Available image models: ${modelList}.`;
};
