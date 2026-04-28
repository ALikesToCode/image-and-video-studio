import {
  CHUTES_IMAGE_MODELS,
  CHUTES_LLM_MODELS,
  CHUTES_TTS_MODELS,
  CHUTES_VIDEO_MODELS,
  GEMINI_IMAGE_MODELS,
  GEMINI_VIDEO_MODELS,
  NAVY_CHAT_MODELS,
  NAVY_IMAGE_MODELS,
  NAVY_TTS_MODELS,
  NAVY_VIDEO_MODELS,
  OPENROUTER_IMAGE_MODELS,
  type ModelOption,
  type Provider,
} from "@/lib/constants";
import type { CapabilityFilter, ModelCapability, ProviderMode } from "./types";

const toMode = (value: string): ProviderMode | null => {
  if (value === "chat" || value === "image" || value === "video") return value;
  if (value === "tts" || value === "audio") return "audio";
  return null;
};

const modesForModel = (
  provider: Provider,
  model: ModelOption,
  fallback: ProviderMode
): ProviderMode[] => {
  const endpoint = String(model.endpoint ?? "").toLowerCase();
  const supports = model.supports ?? {};
  const modes = new Set<ProviderMode>();
  if (supports.imageGeneration || endpoint.includes("image")) modes.add("image");
  if (supports.video || endpoint.includes("video")) modes.add("video");
  if (supports.tts || endpoint.includes("audio") || endpoint.includes("speech")) modes.add("audio");
  if (endpoint.includes("chat")) modes.add("chat");
  if (provider === "openrouter") modes.add("image");
  if (!modes.size) modes.add(fallback);
  return Array.from(modes);
};

const fromModelOption = (
  provider: Provider,
  model: ModelOption,
  fallback: ProviderMode
): ModelCapability => {
  const modes = modesForModel(provider, model, fallback);
  const inputModalities = (model.inputModalities ?? ["text"]).filter(
    (entry): entry is "text" | "image" | "audio" | "video" =>
      entry === "text" || entry === "image" || entry === "audio" || entry === "video"
  );
  const outputModalities = (model.outputModalities ?? modes).flatMap((entry) => {
    const mode = toMode(entry);
    return mode === "chat" ? ["text" as const] : mode ? [mode] : [];
  });

  return {
    provider,
    id: model.id,
    label: model.label,
    modes,
    inputModalities,
    outputModalities: outputModalities.length ? outputModalities : ["text"],
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    tokenizer: model.tokenizer,
    description: model.description,
    metadataSource: model.metadataSource,
    metadataStatus: model.metadataStatus,
    pricing: model.pricing,
    supportsVision: model.supportsVision,
    supportsTools: model.supportsTools,
    supportsFunctionCalling: model.supportsFunctionCalling,
    supportsReasoning: model.supportsReasoning,
    supportsJsonMode: model.supportsJsonMode,
    supportsAudioInput: model.supportsAudioInput,
    supportsImageOutput: model.supportsImageOutput,
    supportsStreaming: model.supportsStreaming,
    supportsNegativePrompt: model.supports?.negativePrompt,
    supportsAspectRatio: model.supports?.aspectRatio,
    supportsImageSize: model.supports?.imageSize || model.supports?.size,
    supportsSeed: model.supports?.seed,
    supportsBatch: fallback === "image",
    maxBatchSize: fallback === "image" ? 4 : undefined,
    supportsImageInput:
      model.supports?.imageEdit ||
      model.supports?.referenceImages ||
      model.supports?.sourceImage ||
      model.supportsVision === true ||
      inputModalities.includes("image"),
    maxReferenceImages:
      model.maxReferenceImages ?? (model.supports?.referenceImages ? 3 : undefined),
    supportsFirstLastFrame:
      model.supports?.firstFrame || model.supports?.lastFrame,
    asyncJob: model.supports?.asyncJobs,
    planGated: model.premium,
    costHint:
      typeof model.tokenMultiplier === "number"
        ? `${model.tokenMultiplier}x token multiplier`
        : undefined,
  };
};

export const STATIC_MODEL_CAPABILITIES: ModelCapability[] = [
  ...GEMINI_IMAGE_MODELS.map((model) => fromModelOption("gemini", model, "image")),
  ...GEMINI_VIDEO_MODELS.map((model) => fromModelOption("gemini", model, "video")),
  ...NAVY_IMAGE_MODELS.map((model) => fromModelOption("navy", model, "image")),
  ...NAVY_VIDEO_MODELS.map((model) => fromModelOption("navy", model, "video")),
  ...NAVY_TTS_MODELS.map((model) => fromModelOption("navy", model, "audio")),
  ...NAVY_CHAT_MODELS.map((model) => fromModelOption("navy", model, "chat")),
  ...OPENROUTER_IMAGE_MODELS.map((model) => fromModelOption("openrouter", model, "image")),
  ...CHUTES_IMAGE_MODELS.map((model) => fromModelOption("chutes", model, "image")),
  ...CHUTES_VIDEO_MODELS.map((model) => fromModelOption("chutes", model, "video")),
  ...CHUTES_TTS_MODELS.map((model) => fromModelOption("chutes", model, "audio")),
  ...CHUTES_LLM_MODELS.map((model) => fromModelOption("chutes", model, "chat")),
];

export const filterModelCapabilities = (
  capabilities: ModelCapability[],
  filter: CapabilityFilter
) =>
  capabilities.filter((capability) => {
    if (filter.provider && capability.provider !== filter.provider) return false;
    if (filter.mode && !capability.modes.includes(filter.mode)) return false;
    if (
      filter.inputModality &&
      !capability.inputModalities.includes(filter.inputModality)
    ) {
      return false;
    }
    if (
      filter.outputModality &&
      !capability.outputModalities.includes(filter.outputModality)
    ) {
      return false;
    }
    return true;
  });

export const mergeModelCapabilities = (
  staticCapabilities: ModelCapability[],
  dynamicCapabilities: ModelCapability[]
) => {
  const merged = new Map<string, ModelCapability>();
  for (const capability of staticCapabilities) {
    merged.set(`${capability.provider}:${capability.id}`, capability);
  }
  for (const capability of dynamicCapabilities) {
    merged.set(`${capability.provider}:${capability.id}`, {
      ...merged.get(`${capability.provider}:${capability.id}`),
      ...capability,
    });
  }
  return Array.from(merged.values());
};
