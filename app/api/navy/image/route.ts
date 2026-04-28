export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
import { IMAGE_MIME_TYPES, parseDataUrl } from "@/lib/studio-validation";
import {
  buildSaferImagePromptForModel,
  buildNavyImageGenerationPayload,
  isLikelyImagePolicyError,
  isNavyGenerationPending,
  supportsSaferImagePromptRetry,
} from "@/lib/studio-generation";

type ImageRequest = {
  apiKey?: string;
  model: string;
  prompt: string;
  size?: string;
  numberOfImages?: number;
  quality?: string;
  style?: string;
  imageUrl?: string | string[];
  imageUrls?: string[];
  image_url?: string | string[];
  negativePrompt?: string;
  seed?: number | null;
  seconds?: number;
  sync?: boolean;
  responseFormat?: string;
  aspectRatio?: string;
  promptAgentModel?: string;
};

type NavyImagePayload = {
  data: string;
  mimeType: string;
};

const NAVY_IMAGE_MEDIA_HOSTS = [
  "api.navy",
  ".api.navy",
  "api.together.ai",
  "replicate.delivery",
  ".replicate.delivery",
  ".blob.core.windows.net",
  "storage.googleapis.com",
  ".storage.googleapis.com",
  ".googleusercontent.com",
];
const retryAfterMs = (response: Response, fallbackMs = 8_000) => {
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

const promptAgentSystemPrompt = (model: string) => {
  const family = model.toLowerCase().includes("nano-banana")
    ? "Gemini Nano Banana"
    : "OpenAI GPT Image";

  return `You are a prompt safety and art-direction agent for ${family} image generation.
Rewrite the user's image prompt for this exact target model before image generation.
Preserve concrete subject, setting, composition, style, pose, mood, lighting, and story details.
Replace explicit sexual focus, coercive/threatening framing, minor-risk ambiguity, and fetishized anatomy with policy-compliant tasteful editorial art direction.
Keep clearly adult subjects when age is given. Do not add new characters or story events.
Return only the final rewritten image prompt, with no markdown, labels, quotes, or explanation.`;
};

const extractPromptAgentContent = (data: unknown) => {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";
  const choice = firstChoice as Record<string, unknown>;
  const message =
    choice.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : null;
  const content = message?.content ?? choice.text;
  return typeof content === "string" ? content.trim() : "";
};

const rewritePromptWithPromptAgent = async ({
  apiKey,
  model,
  prompt,
  promptAgentModel,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  promptAgentModel?: string;
}) => {
  if (!supportsSaferImagePromptRetry(model)) return prompt;
  const agentModel = promptAgentModel?.trim();
  if (!agentModel) return prompt;

  try {
    const response = await fetch("https://api.navy/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: agentModel,
        stream: false,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: promptAgentSystemPrompt(model) },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) return prompt;
    const rewritten = extractPromptAgentContent(await jsonOrNull(response));
    return rewritten || prompt;
  } catch {
    return prompt;
  }
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const contentTypeFromRecord = (record: Record<string, unknown>) =>
  typeof record.mimeType === "string"
    ? record.mimeType
    : typeof record.mime_type === "string"
      ? record.mime_type
      : "image/png";

const dataUrlImagePayload = (value: unknown): NavyImagePayload | null => {
  const parsed = parseDataUrl(value, IMAGE_MIME_TYPES);
  if (parsed) {
    return {
      data: parsed.data,
      mimeType: parsed.mimeType,
    };
  }
  return null;
};

const inlineImagePayload = (
  value: unknown,
  fallbackMimeType: string
): NavyImagePayload | null => {
  const dataUrlPayload = dataUrlImagePayload(value);
  if (dataUrlPayload) return dataUrlPayload;
  if (typeof value !== "string" || !value) return null;
  return {
    data: value,
    mimeType: fallbackMimeType,
  };
};

const downloadGeneratedImage = async (url: string): Promise<NavyImagePayload> => {
  const response = await safeFetchExternalMedia(url, {
    allowedHosts: NAVY_IMAGE_MEDIA_HOSTS,
    allowedContentTypes: ["image/"],
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: 30_000,
    allowRedirects: true,
  });
  const contentType = response.headers.get("content-type") ?? "image/png";
  return {
    data: arrayBufferToBase64(await response.arrayBuffer()),
    mimeType: contentType.split(";")[0] ?? "image/png",
  };
};

const normalizeNavyImages = async (items: unknown[]) => {
  const images: NavyImagePayload[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const contentType = contentTypeFromRecord(record);
    const b64Payload = inlineImagePayload(record.b64_json, contentType);
    if (b64Payload) {
      images.push(b64Payload);
      continue;
    }
    const dataPayload = inlineImagePayload(record.data, contentType);
    if (dataPayload) {
      images.push(dataPayload);
      continue;
    }
    if (typeof record.url === "string" && record.url) {
      const dataUrlPayload = dataUrlImagePayload(record.url);
      if (dataUrlPayload) {
        images.push(dataUrlPayload);
        continue;
      }
      images.push(await downloadGeneratedImage(record.url));
    }
  }
  return images;
};

const navyImageCandidates = (record: Record<string, unknown>) => {
  const result =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : record;
  const items = Array.isArray(result.data) ? [...result.data] : [];
  if (Array.isArray(result.images)) {
    items.push(...result.images);
  }
  if (typeof result.url === "string" || typeof result.data === "string") {
    items.push(result);
  }
  return items;
};

const imageDownloadError = () =>
  Response.json(
    { error: "Unable to download generated image." },
    { status: 502 }
  );

const imageJobFailure = (data: unknown) =>
  Response.json(
    { error: providerErrorMessage(data, "Image generation job failed.") },
    { status: 502 }
  );

const isFailedNavyGenerationStatus = (status: unknown) =>
  typeof status === "string" &&
  /^(failed|failure|error|errored|cancelled|canceled)$/i.test(status.trim());

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const {
    model,
    prompt,
    size,
    numberOfImages,
    quality,
    style,
    negativePrompt,
    seed,
    seconds,
    responseFormat,
    aspectRatio,
    promptAgentModel,
  } = body;
  const imageUrl = body.imageUrl ?? body.imageUrls ?? body.image_url;
  const userApiKey = getUserApiKey(req, body);
  if (!userApiKey || !model || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const postGeneration = (requestPrompt: string) => fetch("https://api.navy/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userApiKey}`,
    },
    body: JSON.stringify(
      buildNavyImageGenerationPayload({
        model,
        prompt: requestPrompt,
        size,
        numberOfImages,
        quality,
        style,
        imageUrl,
        negativePrompt,
        seed,
        seconds,
        sync: false,
        responseFormat,
        aspectRatio,
      })
    ),
  });

  const promptAgentPrompt = await rewritePromptWithPromptAgent({
    apiKey: userApiKey,
    model,
    prompt,
    promptAgentModel,
  });

  let response = await postGeneration(promptAgentPrompt);
  let data = await jsonOrNull(response);
  if (!response.ok) {
    const errorMessage = providerErrorMessage(data, "Image generation failed.", [
      userApiKey,
    ]);
    if (
      supportsSaferImagePromptRetry(model) &&
      isLikelyImagePolicyError(errorMessage)
    ) {
      response = await postGeneration(buildSaferImagePromptForModel(model, promptAgentPrompt));
      data = await jsonOrNull(response);
    }
  }

  if (!response.ok) {
    return Response.json(
      {
        error: providerErrorMessage(data, "Image generation failed.", [
          userApiKey,
        ]),
      },
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isFailedNavyGenerationStatus(dataRecord.status)) {
    return imageJobFailure(data);
  }
  if (typeof dataRecord.id === "string" && !Array.isArray(dataRecord.data)) {
    return Response.json({ id: dataRecord.id, status: dataRecord.status ?? null });
  }

  let images: NavyImagePayload[];
  try {
    images = await normalizeNavyImages(navyImageCandidates(dataRecord));
  } catch {
    return imageDownloadError();
  }

  if (!images?.length) {
    return Response.json(
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const apiKey = req.headers.get("x-user-api-key");

  if (!id || !apiKey) {
    return Response.json({ error: "Missing job id or API key." }, { status: 400 });
  }

  const response = await fetch(`https://api.navy/v1/images/generations/${id}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await jsonOrNull(response);
  if (response.status === 429) {
    const delayMs = retryAfterMs(response);
    return Response.json(
      { done: false, status: "rate_limited", retryAfterMs: delayMs },
      {
        status: 200,
        headers: { "Retry-After": String(Math.ceil(delayMs / 1000)) },
      }
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: providerErrorMessage(data, "Unable to fetch job.", [apiKey]) },
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isFailedNavyGenerationStatus(dataRecord.status)) {
    return imageJobFailure(data);
  }
  if (isNavyGenerationPending(typeof dataRecord.status === "string" ? dataRecord.status : null)) {
    return Response.json({ done: false, status: dataRecord.status });
  }

  let images: NavyImagePayload[];
  try {
    images = await normalizeNavyImages(navyImageCandidates(dataRecord));
  } catch {
    return imageDownloadError();
  }

  if (!images.length) {
    return Response.json(
      { done: true, error: "Image result not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, images });
}
