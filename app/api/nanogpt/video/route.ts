export const runtime = "edge";

import {
  getProviderApiKey,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";
import {
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  isValidModelId,
  normalizeNanoGptVideoJobId,
  parseDataUrl,
} from "@/lib/studio-validation";

type UnknownRecord = Record<string, unknown>;

type VideoRequest = {
  apiKey?: string;
  model?: string;
  prompt?: string;
  parameters?: Record<string, unknown>;
  sourceImage?: string | null;
  sourceVideo?: string | null;
  sourceAudio?: string | null;
  imageDataUrl?: string | null;
  imageUrl?: string | null;
  videoDataUrl?: string | null;
  videoUrl?: string | null;
  audioDataUrl?: string | null;
  referenceImages?: unknown[];
  referenceVideos?: unknown[];
};

const PARAMETER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const RESERVED_PARAMETER_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "x-api-key",
  "x_api_key",
  "model",
  "prompt",
  "parameters",
  "sourceimage",
  "sourcevideo",
  "sourceaudio",
  "imagedataurl",
  "imageurl",
  "videodataurl",
  "videourl",
  "audiodataurl",
  "referenceimages",
  "referencevideos",
  "constructor",
  "prototype",
  "__proto__",
]);

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const safeScalar = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return finiteNumber(value);
  return nonEmptyString(value);
};

const safeDynamicParameters = (value: unknown) => {
  const record = asRecord(value);
  const parameters: UnknownRecord = {};
  if (!record) return parameters;

  for (const [key, rawValue] of Object.entries(record).slice(0, 64)) {
    if (
      !PARAMETER_KEY_PATTERN.test(key) ||
      RESERVED_PARAMETER_KEYS.has(key.toLowerCase())
    ) {
      continue;
    }
    const parameterValue = safeScalar(rawValue);
    if (parameterValue !== undefined) parameters[key] = parameterValue;
  }
  return parameters;
};

const publicHttpsUrl = (value: unknown) => {
  const normalized = nonEmptyString(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const normalizeMedia = (
  value: unknown,
  allowedMimeTypes: readonly string[]
) => parseDataUrl(value, allowedMimeTypes)?.dataUrl ?? publicHttpsUrl(value);

const mediaValueFromRecord = (value: unknown) => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  return (
    record.dataUrl ??
    record.url ??
    record.imageDataUrl ??
    record.imageUrl ??
    record.videoDataUrl ??
    record.videoUrl
  );
};

const normalizeMediaList = (
  value: unknown,
  allowedMimeTypes: readonly string[]
) => {
  if (!Array.isArray(value)) return [];
  const media: string[] = [];
  for (const item of value.slice(0, 10)) {
    const normalized = normalizeMedia(
      mediaValueFromRecord(item),
      allowedMimeTypes
    );
    if (normalized && !media.includes(normalized)) media.push(normalized);
  }
  return media;
};

const setSourceMedia = (
  payload: UnknownRecord,
  value: unknown,
  allowedMimeTypes: readonly string[],
  dataField: string,
  urlField?: string
) => {
  const dataUrl = parseDataUrl(value, allowedMimeTypes)?.dataUrl;
  if (dataUrl) {
    payload[dataField] = dataUrl;
    return;
  }
  const url = publicHttpsUrl(value);
  if (url && urlField) payload[urlField] = url;
};

const buildVideoPayload = (body: VideoRequest, model: string, prompt: string) => {
  const payload: UnknownRecord = {
    model,
    prompt,
    ...safeDynamicParameters(body.parameters),
  };

  setSourceMedia(
    payload,
    body.sourceImage ?? body.imageDataUrl ?? body.imageUrl,
    IMAGE_MIME_TYPES,
    "imageDataUrl",
    "imageUrl"
  );
  setSourceMedia(
    payload,
    body.sourceVideo ?? body.videoDataUrl ?? body.videoUrl,
    VIDEO_MIME_TYPES,
    "videoDataUrl",
    "videoUrl"
  );
  setSourceMedia(
    payload,
    body.sourceAudio ?? body.audioDataUrl,
    AUDIO_MIME_TYPES,
    "audioDataUrl"
  );

  const referenceImages = normalizeMediaList(
    body.referenceImages,
    IMAGE_MIME_TYPES
  );
  const referenceVideos = normalizeMediaList(
    body.referenceVideos,
    VIDEO_MIME_TYPES
  );
  if (referenceImages.length) payload.referenceImages = referenceImages;
  if (referenceVideos.length) payload.referenceVideos = referenceVideos;
  return payload;
};

const billingMetadata = (...records: Array<UnknownRecord | null>) => {
  const metadata: UnknownRecord = {};
  const numberFields = ["cost", "remainingBalance"] as const;
  const stringFields = ["paymentSource", "prechargeLabel"] as const;

  for (const key of numberFields) {
    for (const record of records) {
      const value = finiteNumber(record?.[key]);
      if (value !== undefined) {
        metadata[key] = value;
        break;
      }
    }
  }
  for (const key of stringFields) {
    for (const record of records) {
      const value = nonEmptyString(record?.[key]);
      if (value) {
        metadata[key] = value;
        break;
      }
    }
  }
  return metadata;
};

const statusMetadata = (...records: Array<UnknownRecord | null>) => {
  const metadata: UnknownRecord = {};
  for (const key of ["createdAt", "completedAt"] as const) {
    for (const record of records) {
      const value = nonEmptyString(record?.[key]);
      if (value) {
        metadata[key] = value;
        break;
      }
    }
  }
  for (const key of ["progress", "estimatedTimeRemaining"] as const) {
    for (const record of records) {
      const value = finiteNumber(record?.[key]);
      if (value !== undefined) {
        metadata[key] = value;
        break;
      }
    }
  }
  return metadata;
};

const normalizedStatus = (value: unknown) => {
  const status = nonEmptyString(value)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["in_queue", "queue", "queued", "pending"].includes(status ?? "")) {
    return "queued";
  }
  if (["in_progress", "processing", "running"].includes(status ?? "")) {
    return "processing";
  }
  if (["complete", "completed", "success", "succeeded"].includes(status ?? "")) {
    return "completed";
  }
  if (["error", "failed", "failure"].includes(status ?? "")) {
    return "failed";
  }
  if (["canceled", "cancelled"].includes(status ?? "")) return "canceled";
  return "unknown";
};

const videoUrlFromStatus = (root: UnknownRecord, status: UnknownRecord) => {
  const output = asRecord(status.output) ?? asRecord(root.output);
  const video = asRecord(output?.video);
  return (
    nonEmptyString(video?.url) ??
    nonEmptyString(status.videoUrl) ??
    nonEmptyString(status.video_url) ??
    nonEmptyString(root.videoUrl) ??
    nonEmptyString(root.video_url)
  );
};

const retryAfterMs = (response: Response, fallbackMs = 5_000) => {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1_000, Math.ceil(seconds * 1000));
  }
  const timestamp = Date.parse(retryAfter);
  if (Number.isFinite(timestamp)) {
    return Math.max(1_000, timestamp - Date.now());
  }
  return fallbackMs;
};

export async function POST(req: Request) {
  let body: VideoRequest;
  try {
    const payload = asRecord(await req.json());
    if (!payload) throw new Error("Invalid JSON object");
    body = payload as VideoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const apiKey = getProviderApiKey("nanogpt", req, body);
  const model = nonEmptyString(body.model) ?? "";
  const prompt = nonEmptyString(body.prompt) ?? "";
  if (!apiKey || !isValidModelId(model) || !prompt) {
    return Response.json(
      { error: "Missing or invalid required fields." },
      { status: 400 }
    );
  }

  let response: Response;
  try {
    response = await fetch("https://nano-gpt.com/api/generate-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(buildVideoPayload(body, model, prompt)),
    });
  } catch (error) {
    return Response.json(
      {
        error: providerErrorMessage(
          error,
          "Unable to submit NanoGPT video generation.",
          [apiKey]
        ),
      },
      { status: 502 }
    );
  }

  const data = await jsonOrNull(response);
  if (!response.ok) {
    return Response.json(
      {
        error: providerErrorMessage(data, "Video generation failed.", [apiKey]),
      },
      { status: response.status }
    );
  }

  const record = asRecord(data) ?? {};
  const runId = normalizeNanoGptVideoJobId(record.runId ?? record.id);
  if (!runId) {
    return Response.json(
      { error: "No valid job id returned by NanoGPT." },
      { status: 502 }
    );
  }

  return Response.json(
    {
      id: runId,
      runId,
      status: nonEmptyString(record.status)?.toLowerCase() ?? "pending",
      ...(nonEmptyString(record.model) ? { model: nonEmptyString(record.model) } : {}),
      ...billingMetadata(record),
    },
    { status: 202 }
  );
}

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const rawId =
    searchParams.get("id") ??
    searchParams.get("requestId") ??
    searchParams.get("runId");
  const apiKey = getProviderApiKey("nanogpt", req);
  if (!rawId || !apiKey) {
    return Response.json(
      { error: "Missing job id or API key." },
      { status: 400 }
    );
  }
  const jobId = normalizeNanoGptVideoJobId(rawId);
  if (!jobId) {
    return Response.json({ error: "Invalid job id." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(
      `https://nano-gpt.com/api/video/status?requestId=${encodeURIComponent(jobId)}`,
      { headers: { "x-api-key": apiKey } }
    );
  } catch (error) {
    return Response.json(
      {
        error: providerErrorMessage(
          error,
          "Unable to fetch NanoGPT video job.",
          [apiKey]
        ),
      },
      { status: 502 }
    );
  }

  const data = await jsonOrNull(response);
  if (response.status === 429) {
    const delayMs = retryAfterMs(response);
    return Response.json(
      {
        done: false,
        id: jobId,
        status: "rate_limited",
        retryAfterMs: delayMs,
      },
      {
        headers: { "Retry-After": String(Math.ceil(delayMs / 1000)) },
      }
    );
  }
  if (!response.ok) {
    return Response.json(
      {
        error: providerErrorMessage(
          data,
          "Unable to fetch NanoGPT video job.",
          [apiKey]
        ),
      },
      { status: response.status }
    );
  }

  const root = asRecord(data) ?? {};
  const statusRecord = asRecord(root.data) ?? root;
  const status = normalizedStatus(statusRecord.status ?? root.status);
  const model = nonEmptyString(root.model) ?? nonEmptyString(statusRecord.model);
  const metadata = {
    ...(model ? { model } : {}),
    ...statusMetadata(statusRecord, root),
    ...billingMetadata(statusRecord, root),
  };

  if (status === "queued" || status === "processing" || status === "unknown") {
    return Response.json({ done: false, id: jobId, status, ...metadata });
  }

  if (status === "failed" || status === "canceled") {
    const friendlyError =
      nonEmptyString(statusRecord.userFriendlyError) ??
      nonEmptyString(root.userFriendlyError);
    const errorPayload = friendlyError
      ? { error: friendlyError }
      : statusRecord.error !== undefined
        ? { error: statusRecord.error }
        : root;
    return Response.json(
      {
        done: true,
        id: jobId,
        status,
        error: providerErrorMessage(
          errorPayload,
          status === "canceled"
            ? "Video generation was canceled."
            : "Video generation failed.",
          [apiKey]
        ),
        ...metadata,
      },
      { status: 502 }
    );
  }

  const videoUrl = videoUrlFromStatus(root, statusRecord);
  if (!videoUrl) {
    return Response.json(
      {
        done: true,
        id: jobId,
        status: "completed",
        error: "Video URL not found in NanoGPT response.",
        ...metadata,
      },
      { status: 502 }
    );
  }

  return Response.json({
    done: true,
    id: jobId,
    status: "completed",
    videoUrl,
    ...metadata,
  });
}
