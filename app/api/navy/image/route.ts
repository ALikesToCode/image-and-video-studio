export const runtime = "edge";

import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
import { IMAGE_MIME_TYPES, parseDataUrl } from "@/lib/studio-validation";
import {
  buildSaferImagePromptForModel,
  buildNavyImageGenerationPayload,
  isLikelyImagePolicyError,
  isNavyGenerationPending,
  supportsSaferImagePromptRetry,
} from "@/lib/studio-generation";
import { NAVY_MEDIA_HOSTS } from "@/lib/server/navy-media";

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
  model?: string;
};

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
For OpenAI GPT Image models, follow the OpenAI GPT Image prompting guide: structure the final prompt as background/scene, subject, key details, composition, lighting/mood, and constraints; include the intended format such as photorealistic image, ad, UI mockup, infographic, diagram, logo, product mockup, comic panel, or slide; and use concrete materials, textures, camera/framing, viewpoint, placement, scale, pose, gaze, and object interactions.
Render exact in-image text only when explicitly requested in quotes or ALL CAPS. Preserve requested typography and placement, keep text legible, and do not add extra words.
For edits or reference images, explicitly preserve identity, geometry, layout, brand elements, camera angle, lighting, saturation, contrast, and surrounding objects unless the user asks to change them.
Translate risky intent into a safe visual language instead of hiding it. Preserve the theme through symbolism, fashion, environment, expression, cinematic composition, lighting, texture, and color.
Replace explicit sexual focus, coercive/threatening framing, minor-risk ambiguity, graphic injury, self-harm depiction, weapon-use detail, wrongdoing instructions, deceptive real-person likeness, and fetishized anatomy with tasteful editorial art direction.
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

const normalizedContentType = (value: string) =>
  value.split(";")[0]?.trim().toLowerCase() ?? "";

const nonImageMediaKindFromContentType = (value: string | null | undefined) => {
  if (!value) return null;
  const contentType = normalizedContentType(value);
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return null;
};

const nonImageMediaKindFromUrl = (value: string | null | undefined) => {
  if (!value) return null;
  const dataUrlMediaType = /^data:([^;,]+)/i.exec(value.trim())?.[1];
  const dataUrlMediaKind = nonImageMediaKindFromContentType(dataUrlMediaType);
  if (dataUrlMediaKind) return dataUrlMediaKind;
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (/\.(?:mp4|m4v|mov|webm|mpeg|mpg|avi|mkv)$/.test(pathname)) {
      return "video";
    }
    if (/\.(?:mp3|mpeg|wav|m4a|aac|flac|ogg|opus)$/.test(pathname)) {
      return "audio";
    }
  } catch {
    return null;
  }
  return null;
};

const nonImageMediaErrorMessage = (kind: string) =>
  `NavyAI returned a ${kind} file for this image request. Switch to ${kind === "video" ? "Video" : "Audio"} mode or choose an image-capable NavyAI model.`;

const nonImageMediaKindFromRecord = (record: Record<string, unknown>) => {
  const contentType =
    typeof record.mimeType === "string"
      ? record.mimeType
      : typeof record.mime_type === "string"
        ? record.mime_type
        : typeof record.contentType === "string"
          ? record.contentType
          : typeof record.content_type === "string"
            ? record.content_type
            : null;
  const mediaKind = nonImageMediaKindFromContentType(contentType);
  if (mediaKind) return mediaKind;

  const url =
    typeof record.video_url === "string"
      ? record.video_url
      : typeof record.audio_url === "string"
        ? record.audio_url
        : typeof record.url === "string"
          ? record.url
          : null;
  return nonImageMediaKindFromUrl(url);
};

const nonImageMediaKindFromNavyRecord = (record: Record<string, unknown>) => {
  const result =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : record;
  const records = [record, result];
  for (const field of ["data", "images"]) {
    const items = Array.isArray(result[field]) ? result[field] : [];
    for (const item of items) {
      if (item && typeof item === "object") {
        records.push(item as Record<string, unknown>);
      }
    }
  }
  for (const item of records) {
    const mediaKind = nonImageMediaKindFromRecord(item);
    if (mediaKind) return mediaKind;
  }
  return null;
};

const nonImageMediaKindFromError = (error: unknown) => {
  if (!(error instanceof Error)) return null;
  const match = /Unexpected media content type:\s*([^.;]+)/i.exec(
    error.message
  );
  return nonImageMediaKindFromContentType(match?.[1]);
};

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
  const mediaKind = nonImageMediaKindFromContentType(fallbackMimeType);
  if (mediaKind) {
    throw new Error(`Unexpected media content type: ${fallbackMimeType}.`);
  }
  return {
    data: value,
    mimeType: fallbackMimeType,
  };
};

const downloadGeneratedImage = async (url: string): Promise<NavyImagePayload> => {
  const response = await safeFetchExternalMedia(url, {
    allowedHosts: NAVY_MEDIA_HOSTS,
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

const modelFromNavyRecord = (
  record: Record<string, unknown>,
  fallback?: string
) => {
  const result =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : null;
  const model = typeof record.model === "string" ? record.model : result?.model;
  return typeof model === "string" && model.trim() ? model.trim() : fallback;
};

const imageResponsePayload = (
  images: NavyImagePayload[],
  model?: string,
  extra: Record<string, unknown> = {},
  includeUserscriptShape = false
) => {
  const payloadImages = images.map((image) => ({
    ...image,
    ...(includeUserscriptShape && (image.model || model)
      ? { model: image.model ?? model }
      : {}),
  }));
  const firstImage = payloadImages[0];
  if (!includeUserscriptShape) {
    return {
      ...extra,
      images: payloadImages,
    };
  }
  return {
    ...extra,
    ...(firstImage
      ? {
          imageUrl: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          ...(firstImage.model ? { model: firstImage.model } : {}),
        }
      : model
        ? { model }
        : {}),
    images: payloadImages,
  };
};

const imageDownloadError = (req: Request, error?: unknown) => {
  const mediaKind = nonImageMediaKindFromError(error);
  return janitorAiJsonResponse(
    req,
    {
      error: mediaKind
        ? nonImageMediaErrorMessage(mediaKind)
        : "Unable to download generated image.",
    },
    { status: 502 }
  );
};

const imageJobFailure = (req: Request, data: unknown) =>
  janitorAiJsonResponse(
    req,
    { error: providerErrorMessage(data, "Image generation job failed.") },
    { status: 502 }
  );

const isFailedNavyGenerationStatus = (status: unknown) =>
  typeof status === "string" &&
  /^(failed|failure|error|errored|cancelled|canceled)$/i.test(status.trim());

export async function OPTIONS(req: Request) {
  return janitorAiOptionsResponse(req);
}

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return janitorAiJsonResponse(
      req,
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
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
  const userApiKey = getProviderApiKey("navy", req, body);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req, body);
  if (!userApiKey || !model || !prompt) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing required fields." },
      { status: 400 }
    );
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
    return janitorAiJsonResponse(
      req,
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
    return imageJobFailure(req, data);
  }
  const mediaKind = nonImageMediaKindFromNavyRecord(dataRecord);
  if (mediaKind) {
    return janitorAiJsonResponse(
      req,
      { error: nonImageMediaErrorMessage(mediaKind) },
      { status: 502 }
    );
  }
  if (typeof dataRecord.id === "string" && !Array.isArray(dataRecord.data)) {
    return janitorAiJsonResponse(req, {
      id: dataRecord.id,
      status: dataRecord.status ?? null,
    });
  }

  let images: NavyImagePayload[];
  try {
    images = await normalizeNavyImages(navyImageCandidates(dataRecord));
  } catch (error) {
    return imageDownloadError(req, error);
  }

  if (!images?.length) {
    return janitorAiJsonResponse(
      req,
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return janitorAiJsonResponse(
    req,
    imageResponsePayload(images, model, {}, includeUserscriptShape)
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const apiKey = getProviderApiKey("navy", req);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req);

  if (!id || !apiKey) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing job id or API key." },
      { status: 400 }
    );
  }

  const response = await fetch(`https://api.navy/v1/images/generations/${id}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await jsonOrNull(response);
  if (response.status === 429) {
    const delayMs = retryAfterMs(response);
    return janitorAiJsonResponse(
      req,
      { done: false, status: "rate_limited", retryAfterMs: delayMs },
      {
        status: 200,
        headers: { "Retry-After": String(Math.ceil(delayMs / 1000)) },
      }
    );
  }

  if (!response.ok) {
    return janitorAiJsonResponse(
      req,
      { error: providerErrorMessage(data, "Unable to fetch job.", [apiKey]) },
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isFailedNavyGenerationStatus(dataRecord.status)) {
    return imageJobFailure(req, data);
  }
  if (isNavyGenerationPending(typeof dataRecord.status === "string" ? dataRecord.status : null)) {
    return janitorAiJsonResponse(req, { done: false, status: dataRecord.status });
  }
  const mediaKind = nonImageMediaKindFromNavyRecord(dataRecord);
  if (mediaKind) {
    return janitorAiJsonResponse(
      req,
      { error: nonImageMediaErrorMessage(mediaKind) },
      { status: 502 }
    );
  }

  let images: NavyImagePayload[];
  try {
    images = await normalizeNavyImages(navyImageCandidates(dataRecord));
  } catch (error) {
    return imageDownloadError(req, error);
  }

  if (!images.length) {
    return janitorAiJsonResponse(
      req,
      { done: true, error: "Image result not found in response." },
      { status: 502 }
    );
  }

  return janitorAiJsonResponse(
    req,
    imageResponsePayload(
      images,
      modelFromNavyRecord(dataRecord),
      { done: true },
      includeUserscriptShape
    )
  );
}
