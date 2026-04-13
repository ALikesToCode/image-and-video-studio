import type { ModelOption } from "./constants.ts";
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

const normalizeModalities = (modalities?: string[]) =>
  (modalities ?? []).map((value) => value.toLowerCase());

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
}: NavyImageGenerationInput) => ({
  model,
  prompt,
  ...(size ? { size } : {}),
  ...(typeof numberOfImages === "number" && numberOfImages > 0
    ? { n: numberOfImages }
    : {}),
  ...(quality ? { quality } : {}),
  ...(style ? { style } : {}),
  ...(imageUrl ? { image_url: imageUrl } : {}),
  ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
  ...(typeof seed === "number" ? { seed } : {}),
  ...(typeof seconds === "number" ? { seconds } : {}),
  ...(typeof sync === "boolean" ? { sync } : {}),
  ...(responseFormat ? { response_format: responseFormat } : {}),
  ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
});

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
