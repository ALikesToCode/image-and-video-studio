import {
  getUserApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorDetails,
  providerErrorMessage,
} from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";
import { applyImageModerationDefault } from "@/lib/image-moderation";
import {
  hasMediaReferencePayload,
  normalizeImageReferencePayload,
} from "@/lib/media-reference";
import {
  IMAGE_MIME_TYPES,
  normalizeNavyJobId,
  parseDataUrl,
} from "@/lib/studio-validation";
import {
  buildOpenAIResponsesPayload,
  extractOpenAIResponseText,
  isOpenAIResponsesModel,
} from "@/lib/openai-responses";
import {
  isOutputTokenLimitReached,
  resolvePromptRewriteOutputTokenBudgets,
} from "@/lib/llm-output-budget";
import {
  buildImageRetryFallbackPrompt,
  buildNavyImageGenerationPayload,
  isNavyGenerationFailed,
  isLikelyImagePolicyError,
  isNavyGenerationPending,
  supportsSaferImagePromptRetry,
} from "@/lib/studio-generation";
import {
  buildNavyChatImagePayload,
  isNavyChatImageEndpoint,
} from "@/lib/navy-chat-image";
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
  modelEndpoint?: string;
  outputModalities?: string[];
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
This system message guides your rewrite; never copy it into the final image prompt. Return only the renderable scene and direct visual constraints. Do not mention prompt guides, providers, models, policy, safety, moderation, retries, or invisible instructions.
Treat the user's requested visual medium as authoritative. For anime, manga, cel-shaded, watercolor, comic, or other illustrated output, use medium-native visible details and never introduce photography, live-action, realistic-skin-texture, or subsurface-scattering cues unless the user explicitly requests a hybrid.
Use concrete materials, textures, composition, viewpoint, placement, scale, pose, gaze, and object interactions. Prefer medium-specific details over generic masterpiece, best-quality, ultra-detailed, or 8K keyword stacks.
Render exact in-image text only when explicitly requested in quotes or ALL CAPS. Preserve requested typography and placement, keep text legible, and do not add extra words.
For edits or reference images, explicitly preserve identity, geometry, layout, brand elements, camera angle, lighting, saturation, contrast, and surrounding objects unless the user asks to change them.
Translate risky intent into a safe visual language instead of hiding it. Preserve the theme through symbolism, fashion, environment, expression, cinematic composition, lighting, texture, and color.
Replace explicit sexual focus, coercive/threatening framing, minor-risk ambiguity, graphic injury, self-harm depiction, weapon-use detail, wrongdoing instructions, deceptive real-person likeness, and fetishized anatomy with tasteful editorial art direction.
Replace exact numeric human ages with the matching semantic life stage while preserving whether the subject is a minor or adult. Do not add new characters or story events.
Return only the final rewritten image prompt, with no markdown, labels, quotes, or explanation.`;
};

const extractPromptAgentContent = (data: unknown) => {
  const responseText = extractOpenAIResponseText(data);
  if (responseText) return responseText;
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
  const messages = [
    { role: "system", content: promptAgentSystemPrompt(model) },
    { role: "user", content: prompt },
  ];
  const useResponses = isOpenAIResponsesModel(agentModel);

  try {
    for (const maxTokens of resolvePromptRewriteOutputTokenBudgets(prompt)) {
      const response = await fetch(
        `https://api.navy/v1/${
          useResponses ? "responses" : "chat/completions"
        }`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(
            useResponses
              ? buildOpenAIResponsesPayload({
                  model: agentModel,
                  messages,
                  maxTokens,
                  stream: false,
                })
              : {
                  model: agentModel,
                  stream: false,
                  max_tokens: maxTokens,
                  messages,
                }
          ),
        }
      );

      if (!response.ok) return prompt;
      const data = await jsonOrNull(response);
      if (isOutputTokenLimitReached(data)) continue;
      const rewritten = extractPromptAgentContent(data);
      return rewritten || prompt;
    }
    return prompt;
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
    allowedContentTypes: [...IMAGE_MIME_TYPES],
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
    const directPayload = dataUrlImagePayload(item);
    if (directPayload) {
      images.push(directPayload);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const contentType = contentTypeFromRecord(record);
    const inlineData =
      record.inlineData && typeof record.inlineData === "object"
        ? (record.inlineData as Record<string, unknown>)
        : record.inline_data && typeof record.inline_data === "object"
          ? (record.inline_data as Record<string, unknown>)
          : null;
    const nestedImageUrl =
      record.image_url && typeof record.image_url === "object"
        ? (record.image_url as Record<string, unknown>)
        : record.imageUrl && typeof record.imageUrl === "object"
          ? (record.imageUrl as Record<string, unknown>)
          : null;
    const nestedContentType = inlineData
      ? contentTypeFromRecord(inlineData)
      : contentType;
    const b64Payload = inlineImagePayload(
      record.b64_json ?? record.base64,
      contentType,
    );
    if (b64Payload) {
      images.push(b64Payload);
      continue;
    }
    const dataPayload = inlineImagePayload(record.data, contentType);
    if (dataPayload) {
      images.push(dataPayload);
      continue;
    }
    const inlinePayload = inlineImagePayload(
      inlineData?.data,
      nestedContentType,
    );
    if (inlinePayload) {
      images.push(inlinePayload);
      continue;
    }
    const imageUrl =
      typeof record.url === "string"
        ? record.url
        : typeof record.image_url === "string"
          ? record.image_url
          : typeof record.imageUrl === "string"
            ? record.imageUrl
            : typeof nestedImageUrl?.url === "string"
              ? nestedImageUrl.url
              : "";
    if (imageUrl) {
      const dataUrlPayload = dataUrlImagePayload(imageUrl);
      if (dataUrlPayload) {
        images.push(dataUrlPayload);
        continue;
      }
      images.push(await downloadGeneratedImage(imageUrl));
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
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== "object") continue;
    const messageRecord = message as Record<string, unknown>;
    if (Array.isArray(messageRecord.images)) {
      items.push(...messageRecord.images);
    }
    if (Array.isArray(messageRecord.content)) {
      items.push(...messageRecord.content);
    }
  }
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (Array.isArray(parts)) items.push(...parts);
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

const imageJobFailure = (
  req: Request,
  data: unknown,
  apiKey: string,
  response: Response,
) =>
  janitorAiJsonResponse(
    req,
    providerErrorDetails(data, "Image generation job failed.", {
      knownSecrets: [apiKey],
      response,
    }),
    { status: 502 }
  );

export async function OPTIONS(req: Request) {
  return janitorAiOptionsResponse(req);
}

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = await readJsonRequestObject<ImageRequest>(req);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return janitorAiJsonResponse(
      req,
      { error: details.error },
      { status: details.status }
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
  const requestedImageUrl = body.imageUrl ?? body.imageUrls ?? body.image_url;
  const imageUrl = normalizeImageReferencePayload(requestedImageUrl);
  const userApiKey = getUserApiKey(req, body);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req, body);
  if (!userApiKey || !model || !prompt) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing required fields." },
      { status: 400 }
    );
  }
  if (hasMediaReferencePayload(requestedImageUrl) && !imageUrl) {
    return janitorAiJsonResponse(
      req,
      {
        error:
          "Image references must contain at most five HTTPS or valid image data URLs.",
      },
      { status: 400 }
    );
  }

  const usesChatImageEndpoint = isNavyChatImageEndpoint(body.modelEndpoint);
  const postGeneration = (requestPrompt: string) => fetch(`https://api.navy/v1/${
    usesChatImageEndpoint ? "chat/completions" : "images/generations"
  }`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userApiKey}`,
    },
    body: JSON.stringify(
      usesChatImageEndpoint
        ? buildNavyChatImagePayload({
            model,
            prompt: requestPrompt,
            size,
            numberOfImages,
            imageUrl,
            negativePrompt,
            aspectRatio,
            outputModalities: body.outputModalities,
          })
        : applyImageModerationDefault(
            model,
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
          )
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
      response = await postGeneration(
        buildImageRetryFallbackPrompt({
          model,
          prompt: promptAgentPrompt,
          nextAttempt: 2,
          maxAttempts: 2,
        })
      );
      data = await jsonOrNull(response);
    }
  }

  if (!response.ok) {
    return janitorAiJsonResponse(
      req,
      providerErrorDetails(data, "Image generation failed.", {
        knownSecrets: [userApiKey],
        response,
      }),
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isNavyGenerationFailed(dataRecord.status)) {
    return imageJobFailure(req, data, userApiKey, response);
  }
  const mediaKind = nonImageMediaKindFromNavyRecord(dataRecord);
  if (mediaKind) {
    return janitorAiJsonResponse(
      req,
      { error: nonImageMediaErrorMessage(mediaKind) },
      { status: 502 }
    );
  }
  if (
    !usesChatImageEndpoint &&
    typeof dataRecord.id === "string" &&
    !Array.isArray(dataRecord.data)
  ) {
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
  const apiKey = getUserApiKey(req);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req);

  if (!id || !apiKey) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing job id or API key." },
      { status: 400 }
    );
  }
  const jobId = normalizeNavyJobId(id);
  if (!jobId) {
    return janitorAiJsonResponse(
      req,
      { error: "Invalid job id." },
      { status: 400 }
    );
  }

  const response = await fetch(
    `https://api.navy/v1/images/generations/${encodeURIComponent(jobId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

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
      providerErrorDetails(data, "Unable to fetch job.", {
        knownSecrets: [apiKey],
        response,
      }),
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isNavyGenerationFailed(dataRecord.status)) {
    return imageJobFailure(req, data, apiKey, response);
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
