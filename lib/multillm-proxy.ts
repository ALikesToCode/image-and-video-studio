import type { ModelOption } from "@/lib/constants";
import {
  getUserApiKey,
  providerErrorMessage,
  redactSecrets,
} from "@/lib/api-safety";

export const DEFAULT_MULTILLM_PROXY_BASE_URL =
  "https://multillm-proxy.cserules.workers.dev";

export type MultiLlmMediaSource = "navyai" | "nanogpt" | "linkapi";
export type MultiLlmModelKind = "chat" | "image" | "video" | "audio";

type ModelRecord = Record<string, unknown>;

const SOURCE_LABELS: Record<MultiLlmMediaSource, string> = {
  navyai: "NavyAI",
  nanogpt: "NanoGPT",
  linkapi: "LinkAPI",
};

const isRecord = (value: unknown): value is ModelRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const asStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => asStringList(entry));
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key.toLowerCase());
  }
  const stringValue = asString(value);
  return stringValue ? [stringValue.toLowerCase()] : [];
};

const modelIdentity = (record: ModelRecord) =>
  asString(record.id) ||
  asString(record.model) ||
  asString(record.model_id) ||
  asString(record.slug);

const modelLabel = (record: ModelRecord, fallback: string) =>
  asString(record.label) ||
  asString(record.display_name) ||
  asString(record.displayName) ||
  asString(record.name) ||
  fallback;

const scopedModelKeys: Record<Exclude<MultiLlmModelKind, "chat">, string[]> = {
  image: ["image", "images", "image_models", "imageModels"],
  video: ["video", "videos", "video_models", "videoModels"],
  audio: ["audio", "speech", "tts", "audio_models", "audioModels"],
};

const recordsFrom = (value: unknown): ModelRecord[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
};

const extractModelRecords = (
  payload: unknown,
  kind?: Exclude<MultiLlmModelKind, "chat">
) => {
  if (Array.isArray(payload)) {
    return { records: recordsFrom(payload), scoped: false };
  }
  if (!isRecord(payload)) {
    return { records: [], scoped: false };
  }

  if (kind) {
    for (const key of scopedModelKeys[kind]) {
      const records = recordsFrom(payload[key]);
      if (records.length) return { records, scoped: true };
    }
  }

  for (const key of ["data", "models", "items", "results"]) {
    const records = recordsFrom(payload[key]);
    if (records.length) return { records, scoped: false };
  }

  return { records: [], scoped: false };
};

const modelMetadata = (record: ModelRecord) => {
  const capabilities = isRecord(record.capabilities)
    ? record.capabilities
    : {};
  const architecture = isRecord(record.architecture)
    ? record.architecture
    : {};
  return [
    ...asStringList(record.endpoint),
    ...asStringList(record.endpoints),
    ...asStringList(record.type),
    ...asStringList(record.category),
    ...asStringList(record.modality),
    ...asStringList(record.task),
    ...asStringList(record.input_modalities),
    ...asStringList(record.output_modalities),
    ...asStringList(architecture.modality),
    ...asStringList(architecture.input_modalities),
    ...asStringList(architecture.output_modalities),
    ...asStringList(record.capabilities),
    ...asStringList(capabilities.input_modalities),
    ...asStringList(capabilities.output_modalities),
    asString(record.id).toLowerCase(),
    asString(record.name).toLowerCase(),
    asString(record.description).toLowerCase(),
  ].join(" ");
};

const truthyCapability = (record: ModelRecord, keys: string[]) => {
  const capabilities = isRecord(record.capabilities)
    ? record.capabilities
    : {};
  return keys.some(
    (key) => record[key] === true || capabilities[key] === true
  );
};

export const modelSupportsKind = (
  record: ModelRecord,
  kind: Exclude<MultiLlmModelKind, "chat">
) => {
  const metadata = modelMetadata(record);
  const endpoint = asString(record.endpoint).toLowerCase();

  if (kind === "audio") {
    if (endpoint) return endpoint.includes("audio/speech");
    const isTranscriptionOnly =
      /\b(transcription|speech.to.text|stt|whisper)\b/.test(metadata) &&
      !/\b(text.to.speech|tts|music)\b/.test(metadata);
    if (isTranscriptionOnly) return false;
    return (
      truthyCapability(record, [
        "supports_audio_output",
        "supports_speech",
        "supports_tts",
      ]) ||
      /\b(text.to.audio|text.to.speech|speech|tts|music)\b/.test(metadata)
    );
  }

  if (kind === "video") {
    if (endpoint && !endpoint.includes("images/generations")) return false;
    return (
      endpoint.includes("generate-video") ||
      truthyCapability(record, ["supports_video_output", "supports_video"]) ||
      /\b(video|veo|sora|kling|cogvideo|seedance|wan)\b/.test(metadata)
    );
  }

  if (endpoint && !endpoint.includes("images/generations")) return false;
  const hasImageCapability =
    endpoint.includes("images/generations") ||
    truthyCapability(record, [
      "supports_image_output",
      "supports_images",
      "supports_image_generation",
    ]) ||
    /\b(image|flux|dall-e|imagen|hidream|stable diffusion)\b/.test(metadata);

  return (
    hasImageCapability &&
    !truthyCapability(record, ["supports_video_output", "supports_video"]) &&
    !/\b(video|veo|sora|kling|cogvideo|seedance)\b/.test(metadata)
  );
};

export const normalizeModelOptions = (
  payload: unknown,
  options: {
    source?: MultiLlmMediaSource;
    kind?: Exclude<MultiLlmModelKind, "chat">;
    assumeKind?: boolean;
  } = {}
): ModelOption[] => {
  const { records, scoped } = extractModelRecords(payload, options.kind);
  const filtered =
    options.kind && !options.assumeKind && !scoped
      ? records.filter((record) => modelSupportsKind(record, options.kind!))
      : records;
  const deduplicated = new Map<string, ModelOption>();

  for (const record of filtered) {
    const rawId = modelIdentity(record);
    if (!rawId) continue;
    const id = options.source
      ? `${options.source}:${rawId.replace(
          new RegExp(`^${options.source}:`),
          ""
        )}`
      : rawId;
    const label = options.source
      ? `${SOURCE_LABELS[options.source]} · ${modelLabel(record, rawId)}`
      : modelLabel(record, rawId);
    const kind = options.kind ?? "chat";
    const inputModalities = [
      ...asStringList(record.input_modalities),
      ...(isRecord(record.architecture)
        ? asStringList(record.architecture.input_modalities)
        : []),
    ];
    const outputModalities = [
      ...asStringList(record.output_modalities),
      ...(isRecord(record.architecture)
        ? asStringList(record.architecture.output_modalities)
        : []),
    ];
    const endpoint =
      kind === "chat"
        ? "multillm-chat-completions"
        : kind === "image"
          ? "multillm-images-generations"
          : kind === "video"
            ? "multillm-video-generation"
            : "multillm-audio-speech";
    const supports =
      kind === "image"
        ? {
            imageGeneration: true,
            asyncJobs: options.source === "navyai",
            size: true,
            aspectRatio: options.source !== "linkapi",
          }
        : kind === "video"
          ? {
              video: true,
              textToVideo: true,
              imageToVideo: true,
              sourceImage: true,
              asyncJobs: true,
              size: true,
              aspectRatio: true,
            }
          : kind === "audio"
            ? { tts: true }
            : undefined;
    deduplicated.set(id, {
      id,
      label,
      provider: "multillm",
      endpoint,
      inputModalities:
        inputModalities.length > 0
          ? [...new Set(inputModalities)]
          : kind === "video"
            ? ["text", "image"]
            : ["text"],
      outputModalities:
        outputModalities.length > 0
          ? [...new Set(outputModalities)]
          : [kind === "chat" ? "text" : kind],
      ...(kind === "chat"
        ? {
            supportsStreaming: true,
            supportsTools:
              typeof record.supports_tools === "boolean"
                ? record.supports_tools
                : undefined,
            supportsFunctionCalling:
              typeof record.supports_function_calling === "boolean"
                ? record.supports_function_calling
                : undefined,
            supportsReasoning:
              typeof record.supports_reasoning === "boolean"
                ? record.supports_reasoning
                : undefined,
          }
        : {}),
      ...(kind === "image" ? { supportsImageOutput: true } : {}),
      ...(supports ? { supports } : {}),
      ...(kind === "image" && options.source === "linkapi"
        ? { maxReferenceImages: 0 }
        : {}),
      ...(kind === "video" ? { maxReferenceImages: 1 } : {}),
      metadataSource: "multillm-live-catalog",
      metadataStatus: "live",
    });
  }

  return [...deduplicated.values()];
};

export const parseMediaModelId = (value: unknown) => {
  const modelRef = asString(value);
  const separator = modelRef.indexOf(":");
  const source = modelRef.slice(0, separator);
  const model = modelRef.slice(separator + 1).trim();

  if (
    (source !== "navyai" &&
      source !== "nanogpt" &&
      source !== "linkapi") ||
    !model
  ) {
    throw new Error(
      "Media model must include a navyai:, nanogpt:, or linkapi: source prefix."
    );
  }

  return { source: source as MultiLlmMediaSource, model };
};

export const getMultiLlmProxyBaseUrl = () => {
  const configured =
    process.env.PROXY_BASE_URL?.trim() ||
    process.env.MULTILLM_PROXY_BASE_URL?.trim() ||
    DEFAULT_MULTILLM_PROXY_BASE_URL;
  const parsed = new URL(configured);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MultiLLM proxy base URL must use HTTP or HTTPS.");
  }
  return configured.replace(/\/+$/, "");
};

export const resolveMultiLlmApiKey = (
  request: Request,
  bodyApiKey?: unknown
) => {
  const serverKey = asString(process.env.MULTILLM_API_KEY);
  if (serverKey) return serverKey;
  return getUserApiKey(
    request,
    asString(bodyApiKey) ? { apiKey: asString(bodyApiKey) } : undefined
  );
};

export const multiLlmAuthorizationHeaders = (
  apiKey: string,
  contentType?: string
) => ({
  Authorization: `Bearer ${apiKey}`,
  ...(contentType ? { "Content-Type": contentType } : {}),
});

export const multiLlmErrorMessage = (
  error: unknown,
  fallback: string,
  apiKey?: string
) =>
  providerErrorMessage(error, fallback, apiKey ? [apiKey] : []).slice(0, 1000);

export const readUpstreamError = async (
  response: Response,
  fallback: string,
  knownSecrets: string[] = []
) => {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as unknown;
    return providerErrorMessage(payload, fallback, knownSecrets).slice(0, 1000);
  } catch {
    // The upstream sometimes returns plain-text errors.
  }
  return redactSecrets(text, knownSecrets).trim().slice(0, 1000) || fallback;
};

export type NormalizedImageItem = {
  data?: string;
  url?: string;
  mimeType: string;
};

export const extractImageItems = (payload: unknown): NormalizedImageItem[] => {
  if (!isRecord(payload)) return [];
  const result = isRecord(payload.result) ? payload.result : {};
  const candidates = [
    payload.images,
    payload.data,
    result.images,
    result.data,
  ].find(Array.isArray);

  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const data =
        asString(entry.b64_json) ||
        asString(entry.data) ||
        asString(entry.base64);
      const url = asString(entry.url);
      if (!data && !url) return null;
      return {
        ...(data ? { data } : {}),
        ...(url ? { url } : {}),
        mimeType:
          asString(entry.mimeType) ||
          asString(entry.mime_type) ||
          "image/png",
      };
    })
    .filter((entry): entry is NormalizedImageItem => entry !== null);
};

const nestedRecord = (value: unknown, key: string) =>
  isRecord(value) && isRecord(value[key]) ? value[key] : {};

const nestedString = (value: unknown, path: string[]) => {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isInteger(index)) return "";
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return asString(current);
};

export const extractJobId = (payload: unknown) => {
  if (!isRecord(payload)) return "";
  return (
    asString(payload.id) ||
    asString(payload.runId) ||
    asString(payload.requestId) ||
    asString(payload.job_id) ||
    asString(payload.jobId)
  );
};

export type ParsedVideoJob = {
  done: boolean;
  status: string;
  videoUrl?: string;
  error?: string;
};

export const parseVideoJobPayload = (payload: unknown): ParsedVideoJob => {
  if (!isRecord(payload)) {
    return { done: false, status: "processing" };
  }

  const data = nestedRecord(payload, "data");
  const result = nestedRecord(payload, "result");
  const status = (
    asString(data.status) ||
    asString(result.status) ||
    asString(payload.status) ||
    "processing"
  ).toLowerCase();
  const videoUrl =
    asString(payload.videoUrl) ||
    asString(payload.url) ||
    nestedString(payload, ["data", "output", "video", "url"]) ||
    nestedString(payload, ["result", "output", "video", "url"]) ||
    nestedString(payload, ["data", "0", "url"]) ||
    nestedString(payload, ["result", "0", "url"]) ||
    nestedString(payload, ["result", "data", "0", "url"]) ||
    nestedString(payload, ["data", "data", "0", "url"]);
  const error =
    asString(data.userFriendlyError) ||
    asString(data.error) ||
    asString(result.error) ||
    (isRecord(payload.error)
      ? asString(payload.error.message)
      : asString(payload.error));

  if (
    ["failed", "error", "canceled", "cancelled"].includes(status) ||
    (error && !videoUrl)
  ) {
    return {
      done: true,
      status,
      error: error || "Video generation failed.",
    };
  }

  if (
    videoUrl ||
    ["completed", "complete", "success", "succeeded"].includes(status)
  ) {
    return {
      done: true,
      status,
      ...(videoUrl ? { videoUrl } : {}),
      ...(!videoUrl ? { error: "Completed job did not include a video URL." } : {}),
    };
  }

  return { done: false, status };
};
