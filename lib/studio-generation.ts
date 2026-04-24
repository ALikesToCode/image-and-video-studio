import {
  AUTO_IMAGE_OPTION,
  type ModelOption,
  type Provider,
} from "./constants.ts";
import type { GeneratedImage } from "./types.ts";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";

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

const normalizeModalities = (modalities?: string[]) =>
  (modalities ?? []).map((value) => value.toLowerCase());

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

const isOpenAiImageModel = (model: string) =>
  model.toLowerCase().includes("gpt-image-");

const isGeminiNativeImageModel = (model: string) => {
  const normalized = model.toLowerCase();
  return normalized.includes("gemini-") &&
    (normalized.includes("flash-image") || normalized.includes("pro-image"));
};

const isLikelyAdultImagePrompt = (prompt: string) =>
  ADULT_IMAGE_PROMPT_PATTERN.test(prompt);

const buildOpenAiAdultImagePolicyNote = () =>
  "Policy guardrails: Keep any adult sexual content limited to clearly consenting adults. Do not include minors, non-consensual sexual content, sexual violence, or deceptive likeness abuse. Respect OpenAI safety policies and moderation instead of trying to bypass them.";

const buildGeminiAdultImagePolicyNote = () =>
  "Policy guardrails: Respect Gemini safety settings for sexually explicit content and the built-in child safety protections. Keep any adult sexual content limited to adults, and do not try to bypass Gemini filtering.";

const buildAdultImagePolicyNoteForModel = (model: string, prompt: string) => {
  if (!isLikelyAdultImagePrompt(prompt)) return "";
  if (isOpenAiImageModel(model)) return buildOpenAiAdultImagePolicyNote();
  if (isGeminiNativeImageModel(model)) return buildGeminiAdultImagePolicyNote();
  return "";
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
        if (index === 0 && /^create\s+/i.test(trimmed)) {
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

  if (!isFluxModel(model)) {
    return {
      prompt: adultPolicyNote
        ? appendPromptNote(normalizedPrompt, adultPolicyNote)
        : normalizedPrompt,
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
    record.output_modalities ?? record.outputModalities
  ).filter((entry): entry is string => typeof entry === "string");

  return {
    id,
    label,
    ...(outputModalities.length ? { outputModalities } : {}),
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
        typeof record.endpoint === "string" ? record.endpoint.toLowerCase() : "";
      const id = model.id.toLowerCase();

      if (
        endpoint.includes("/v1/chat/completions") ||
        endpoint.includes("/v1/messages") ||
        endpoint.includes("/v1/responses")
      ) {
        pushUniqueModel(groups.chat, model);
        return groups;
      }

      if (
        endpoint.includes("/v1/audio/speech") ||
        (!endpoint &&
          NAVY_TTS_MODEL_PATTERN.test(id) &&
          !NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id))
      ) {
        pushUniqueModel(groups.audio, model);
        return groups;
      }

      if (
        endpoint.includes("/v1/images/generations") ||
        endpoint.includes("/images/generations") ||
        !endpoint
      ) {
        if (NAVY_VIDEO_MODEL_PATTERN.test(id)) {
          pushUniqueModel(groups.video, model);
        } else if (!NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id)) {
          pushUniqueModel(groups.image, model);
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
      "For OpenAI GPT Image models, preserve lawful adult intent when requested, but keep prompts limited to consenting adults and never include minors, non-consensual sexual content, sexual violence, or deceptive likeness abuse."
    );
  }
  if (models.some(isGeminiNativeImageModel)) {
    hints.push(
      "For Gemini Nano Banana models, preserve lawful adult intent when requested, but respect Gemini safety settings for sexually explicit content and the built-in child safety protections."
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
  const shouldPreferAspectRatio =
    typeof aspectRatio === "string" && aspectRatio.trim() !== "" && aspectRatio !== "1:1";
  const isLikelyVideoModel = NAVY_VIDEO_MODEL_PATTERN.test(model);

  return {
  model,
  prompt: preparedPrompt.prompt,
  ...(!shouldPreferAspectRatio && size ? { size } : {}),
  ...(typeof numberOfImages === "number" && numberOfImages > 0
    ? { n: numberOfImages }
    : {}),
  ...(quality || !isLikelyVideoModel ? { quality: quality ?? "medium" } : {}),
  ...(style ? { style } : {}),
  ...(imageUrl ? { image_url: imageUrl } : {}),
  ...(preparedPrompt.negativePrompt
    ? { negative_prompt: preparedPrompt.negativePrompt }
    : {}),
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
- For FLUX-style models, avoid negative prompts and rewrite exclusions as positive visual instructions.
- After the tool returns, briefly confirm what was generated and keep the response concise.

Default image model: ${toolImageModel}.
Available image models: ${modelList}.`;
};
