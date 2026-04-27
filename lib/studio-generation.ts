import {
  AUTO_IMAGE_OPTION,
  type ModelOption,
  type Provider,
} from "./constants.ts";
import type { GeneratedImage } from "./types.ts";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import {
  IMAGE_MIME_TYPES,
  dataUrlToInlineData,
  normalizeVeoDuration,
  parseDataUrl,
} from "./studio-validation.ts";

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
  imageUrl?: string;
  negativePrompt?: string;
  seed?: number | null;
  seconds?: number;
  sync?: boolean;
  responseFormat?: string;
  aspectRatio?: string;
};

type NavyModelGroups = {
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

const normalizeModalities = (modalities?: string[]) =>
  (modalities ?? []).map((value) => value.toLowerCase());

const normalizeEndpoint = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : "";

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

const ensureSentence = (value: string) => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const appendPromptNote = (prompt: string, note: string) => {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return note;
  if (normalizedPrompt.toLowerCase().includes(note.toLowerCase())) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt}\n\n${note}`;
};

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

const ADULT_IMAGE_PROMPT_PATTERN =
  /\b(nsfw|nude|nudity|naked|erotic|boudoir|lingerie|topless|breasts?|nipples?|sexual|sex|sensual|intimate|provocative|seductive)\b/i;
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

export const isImagenModel = (model: string) => model.startsWith("imagen-");

const isOpenAiImageModel = (model: string) =>
  /\b(gpt-image-|dall-e-)/i.test(model);

const isGeminiNativeImageModel = (model: string) => {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("nano-banana") ||
    (normalized.includes("gemini-") &&
      (normalized.includes("flash-image") || normalized.includes("pro-image")))
  );
};

const isGeminiImagePolicyModel = (model: string) => {
  const normalized = model.toLowerCase();
  return (
    isGeminiNativeImageModel(model) ||
    isImagenModel(normalized) ||
    normalized.includes("/imagen-")
  );
};

const isLikelyAdultImagePrompt = (prompt: string) =>
  ADULT_IMAGE_PROMPT_PATTERN.test(prompt);

const buildOpenAiAdultImagePolicyNote = () =>
  "Policy guardrails: Keep any adult sexual content limited to clearly consenting adults. Do not include minors, non-consensual sexual content, sexual violence, or deceptive likeness abuse. Respect OpenAI safety policies and moderation instead of trying to bypass them.";

const buildGeminiAdultImagePolicyNote = () =>
  "Policy guardrails: Respect Gemini safety settings for sexually explicit content and the built-in child safety protections. Keep any adult sexual content limited to adults, and do not try to bypass Gemini filtering.";

const buildArtisticPolicyNoteForModel = (model: string) => {
  if (isOpenAiImageModel(model)) {
    return "System prompt: Create a policy-compliant artistic image prompt. Preserve all concrete subject, setting, composition, style, mood, and detail from the user request while rendering it with rich composition, tasteful art direction, and high visual clarity.";
  }
  if (isGeminiNativeImageModel(model)) {
    return "System prompt: Create a policy-compliant Gemini Nano Banana image prompt. Preserve all concrete subject, setting, composition, style, mood, and detail from the user request while adding painterly visual detail, strong lighting, and high visual clarity.";
  }
  return "";
};

const buildAdultImagePolicyNoteForModel = (model: string, prompt: string) => {
  if (!isLikelyAdultImagePrompt(prompt)) return "";
  if (isOpenAiImageModel(model)) return buildOpenAiAdultImagePolicyNote();
  if (isGeminiImagePolicyModel(model)) return buildGeminiAdultImagePolicyNote();
  return "";
};

export const supportsSaferImagePromptRetry = (model: string) =>
  isOpenAiImageModel(model) || isGeminiImagePolicyModel(model);

export const isLikelyImagePolicyError = (message: string) =>
  /\b(policy|safety|safe|blocked|flagged|prohibited|moderation|filtered|responsibleai|violation|unsafe)\b/i.test(
    message
  );

export const buildSaferImagePromptForModel = (model: string, prompt: string) => {
  const normalizedPrompt = normalizeWhitespace(prompt);
  if (!supportsSaferImagePromptRetry(model)) return normalizedPrompt;

  const policyNote = isOpenAiImageModel(model)
    ? "Safety recovery: Rewrite this as a policy-compliant OpenAI image prompt. Preserve the user's lawful visual intent, but remove or soften any explicit sexual, graphic, non-consensual, minor-related, deceptive likeness, or otherwise disallowed details. Use clearly adult subjects only when people are relevant, and prefer tasteful editorial styling over explicit depiction."
    : "Safety recovery: Rewrite this as a policy-compliant Gemini image prompt. Preserve the user's lawful visual intent, but respect Gemini built-in safety filtering, avoid sexually explicit output, avoid any child-safety risk, and remove or soften details likely to trigger prohibited-content or image-safety blocks.";

  return appendPromptNote(normalizedPrompt, policyNote);
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
  /\b(crisp fine details|coherent anatomy|artifact-free rendering)\b/i.test(prompt);

export const buildFluxImagePrompt = (prompt: string, negativePrompt?: string) => {
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
            `Artwork direction: ${trimmed.replace(/^create\s+/i, "").trim()}`
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
  negativePrompt?: string
) => {
  const rawPrompt = prompt.trim().replace(/\r\n/g, "\n");
  const normalizedPrompt = normalizeWhitespace(prompt);
  const trimmedNegativePrompt = negativePrompt?.trim() || undefined;
  const adultPolicyNote = buildAdultImagePolicyNoteForModel(
    model,
    normalizedPrompt
  );
  const artisticPolicyNote = buildArtisticPolicyNoteForModel(model);

  if (!isFluxModel(model)) {
    const promptWithArtDirection = artisticPolicyNote
      ? appendPromptNote(normalizedPrompt, artisticPolicyNote)
      : normalizedPrompt;
    return {
      prompt: adultPolicyNote
        ? appendPromptNote(promptWithArtDirection, adultPolicyNote)
        : promptWithArtDirection,
      negativePrompt: trimmedNegativePrompt,
    };
  }

  const fluxPrompt = isPreparedFluxPrompt(rawPrompt)
    ? rawPrompt
    : buildFluxImagePrompt(normalizedPrompt, trimmedNegativePrompt);
  return {
    prompt: adultPolicyNote
      ? appendPromptNote(fluxPrompt, adultPolicyNote)
      : fluxPrompt,
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
      body: {
        ...baseBody,
        model,
        prompt: prepared.prompt,
        ...(includeNegativePrompt && prepared.negativePrompt
          ? { negativePrompt: prepared.negativePrompt }
          : {}),
      },
    };
  });

export const summarizeImageModelPrompts = (
  requests: Pick<PreparedImageModelRequest, "model" | "prompt">[]
) => {
  const uniquePrompts = Array.from(
    new Set(requests.map((request) => request.prompt).filter(Boolean))
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
  { imageAspect, imageSize, navyImageSize }: ImageSizingOptionsInput
): ImageSizingOptions => {
  const sizing: ImageSizingOptions = {};

  if (
    (provider === "gemini" || provider === "openrouter" || provider === "navy") &&
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

  if (provider === "navy" && !isAutoImageOption(navyImageSize)) {
    sizing.size = navyImageSize;
  }

  return sizing;
};

export const resolveNavyChatImageSizing = (value: string): NavyChatImageSizing => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return {};
  if (NAVY_IMAGE_ASPECT_RATIOS.has(normalized)) {
    return { aspectRatio: normalized };
  }
  if (NAVY_IMAGE_PIXEL_SIZES.has(normalized)) {
    return { size: normalized };
  }
  return {};
};

const sanitizeReferenceImages = (
  referenceImages?: ReferenceImageInput[],
  maxItems = 10
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
    .filter((reference): reference is SanitizedReferenceImage => reference !== null)
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

  const parts: Array<Record<string, unknown>> = [{ text: preparedPrompt.prompt }];
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
        reference.role !== "last_frame"
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

export const isFluxModel = (model: string) => /(^|[/:.-])flux([/:.-]|$)/i.test(model);

export const resolveOpenRouterModalities = (
  model: string,
  outputModalities?: string[]
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
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

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
  const outputModalities = asArray(
    record.output_modalities ??
      record.outputModalities ??
      asRecord(record.architecture)?.output_modalities
  ).filter((entry): entry is string => typeof entry === "string");
  const inputModalities = asArray(
    record.input_modalities ??
      record.inputModalities ??
      asRecord(record.architecture)?.input_modalities
  ).filter((entry): entry is string => typeof entry === "string");
  const endpoint =
    typeof record.endpoint === "string" ? record.endpoint : undefined;
  const provider =
    typeof record.owned_by === "string"
      ? record.owned_by
      : typeof record.provider === "string"
        ? record.provider
        : undefined;
  const premium = typeof record.premium === "boolean" ? record.premium : undefined;
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

  return {
    id,
    label,
    ...(provider ? { provider } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(inputModalities.length ? { inputModalities } : {}),
    ...(outputModalities.length ? { outputModalities } : {}),
    ...(typeof premium === "boolean" ? { premium } : {}),
    ...(requiredPlan !== undefined ? { requiredPlan } : {}),
    ...(typeof tokenMultiplier === "number" ? { tokenMultiplier } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
  };
};

export const extractOpenRouterImageModels = (payload: unknown): ModelOption[] => {
  const rawModels = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.data);

  return rawModels
    .map(toModelOption)
    .filter((entry): entry is ModelOption => {
      if (!entry) return false;
      const modalities = normalizeModalities(entry.outputModalities);
      if (!modalities.length) return true;
      return modalities.includes("image");
    });
};

export const groupNavyModelsByCapability = (payload: unknown): NavyModelGroups => {
  const rawModels = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.data ?? payload);

  return rawModels.reduce<NavyModelGroups>(
    (groups, entry) => {
      const record = asRecord(entry);
      const model = toModelOption(entry);
      if (!record || !model) return groups;

      const endpoint =
        normalizeEndpoint(record.endpoint);
      const id = model.id.toLowerCase();

      if (
        endpoint.includes("/v1/chat/completions") ||
        endpoint.includes("/v1/messages") ||
        endpoint.includes("/v1/responses")
      ) {
        pushUniqueModel(groups.chat, {
          ...model,
          supports: { ...(model.supports ?? {}) },
        });
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

      if (
        endpoint.includes("/v1/videos/generations") ||
        endpoint.includes("/videos/generations")
      ) {
        pushUniqueModel(groups.video, {
          ...model,
          supports: {
            ...(model.supports ?? {}),
            video: true,
            asyncJobs: true,
            sourceImage: true,
            aspectRatio: true,
            negativePrompt: true,
          },
        });
        return groups;
      }

      if (
        endpoint.includes("/v1/images/generations") ||
        endpoint.includes("/images/generations") ||
        !endpoint
      ) {
        if (NAVY_VIDEO_MODEL_PATTERN.test(id)) {
          pushUniqueModel(groups.video, {
            ...model,
            supports: {
              ...(model.supports ?? {}),
              video: true,
              asyncJobs: true,
              sourceImage: true,
              aspectRatio: true,
              negativePrompt: true,
            },
          });
        } else if (!NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id)) {
          pushUniqueModel(groups.image, {
            ...model,
            supports: {
              ...(model.supports ?? {}),
              imageGeneration: true,
              sourceImage: true,
              aspectRatio: true,
              size: true,
              seed: true,
            },
          });
        }
      }

      return groups;
    },
    { chat: [], image: [], video: [], audio: [] }
  );
};

export const resolveImageGenerationModelPipeline = (
  preferredModels: string[],
  fallbackModel: string,
  availableModels: string[]
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
    availableModels
  );

export const buildProviderPolicyHintForImageModels = (models: string[]) => {
  const hints: string[] = [];
  if (models.some(isOpenAiImageModel)) {
    hints.push(
      "For OpenAI GPT Image models, preserve lawful adult intent and concrete visual details while adding artistic direction, but keep prompts policy-compliant: consenting adults only when adult themes are relevant, and never include minors, non-consensual sexual content, sexual violence, or deceptive likeness abuse."
    );
  }
  if (models.some(isGeminiNativeImageModel)) {
    hints.push(
      "For Gemini Nano Banana models, preserve lawful adult intent and concrete visual details while adding painterly art direction, but respect Gemini safety settings for sexually explicit content and the built-in child safety protections."
    );
  }
  return hints.join("\n");
};

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
  } = {}
) => {
  const activeSet = new Set(activeIds);
  let availableImageSlots =
    maxConcurrentImageJobs -
    jobs.filter((job) => job.status === "running" && job.mode === "image").length;
  let availableNonImageSlots =
    maxConcurrentNonImageJobs -
    jobs.filter((job) => job.status === "running" && job.mode !== "image").length;

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
  incoming: GeneratedImage[]
) =>
  [...existing, ...incoming].sort((left, right) => {
    const batchDateCompare =
      (left.batchCreatedAt ?? left.createdAt ?? "").localeCompare(
        right.batchCreatedAt ?? right.createdAt ?? ""
      );
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

export const buildNavyImageGenerationPayload = ({
  model,
  prompt,
  size,
  numberOfImages,
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
  const preparedPrompt = prepareImagePromptForModel(model, prompt, negativePrompt);
  const promptWithNegativeGuidance = preparedPrompt.negativePrompt
    ? appendPromptNote(
        preparedPrompt.prompt,
        `Avoid these visual issues: ${preparedPrompt.negativePrompt}.`
      )
    : preparedPrompt.prompt;
  const shouldPreferAspectRatio =
    typeof aspectRatio === "string" && aspectRatio.trim() !== "" && aspectRatio !== "1:1";
  const isLikelyVideoModel = NAVY_VIDEO_MODEL_PATTERN.test(model);

  return {
  model,
  prompt: promptWithNegativeGuidance,
  ...(!shouldPreferAspectRatio && size ? { size } : {}),
  ...(typeof numberOfImages === "number" && numberOfImages > 0
    ? { n: numberOfImages }
    : {}),
  ...(quality || !isLikelyVideoModel ? { quality: quality ?? "medium" } : {}),
  ...(style ? { style } : {}),
  ...(imageUrl ? { image_url: imageUrl } : {}),
  ...(typeof seed === "number" ? { seed } : {}),
  ...(typeof seconds === "number" ? { seconds } : {}),
  ...(typeof sync === "boolean" ? { sync } : {}),
  ...(responseFormat ? { response_format: responseFormat } : {}),
  ...(shouldPreferAspectRatio ? { aspect_ratio: aspectRatio } : {}),
};
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
