import {
  extractImageItems,
  extractJobId,
  getMultiLlmProxyBaseUrl,
  isGeminiChatImageModel,
  isLinkApiChatImageModel,
  multiLlmAuthorizationHeaders,
  parseMediaModelId,
  readUpstreamErrorDetails,
  resolveMultiLlmApiKey,
  sanitizeImageInputUrls,
  type MultiLlmMediaSource,
  type NormalizedImageItem,
} from "@/lib/multillm-proxy";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
import { buildNavyImageGenerationPayload } from "@/lib/studio-generation";

export const dynamic = "force-dynamic";

type ImageRequest = {
  apiKey?: string;
  model?: string;
  prompt?: string;
  size?: string;
  aspectRatio?: string;
  numberOfImages?: number;
  quality?: string;
  style?: string;
  negativePrompt?: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  parameters?: Record<string, unknown>;
  sync?: boolean;
  modelEndpoint?: string;
  outputModalities?: string[];
};

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const materializeImages = async (items: NormalizedImageItem[]) =>
  Promise.all(
    items.map(async (item) => {
      if (item.data) {
        return { data: item.data, mimeType: item.mimeType };
      }
      const mediaUrl = new URL(item.url!);
      const response = await safeFetchExternalMedia(mediaUrl.toString(), {
        allowedHosts: [mediaUrl.hostname],
        allowedContentTypes: ["image/"],
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
        allowRedirects: true,
      });
      const mimeType =
        response.headers.get("content-type")?.split(";")[0] || item.mimeType;
      return {
        data: arrayBufferToBase64(await response.arrayBuffer()),
        mimeType,
      };
    })
  );

const jobStatus = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return "processing";
  const record = payload as Record<string, unknown>;
  const result =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : {};
  const status =
    (typeof record.status === "string" && record.status) ||
    (typeof result.status === "string" && result.status) ||
    "processing";
  return status.toLowerCase();
};

const usesDeclaredImageChatEndpoint = (value: unknown) => {
  if (typeof value !== "string") return false;
  const endpoint = value.trim().replace(/\/+$/, "").toLowerCase();
  return (
    endpoint === "/v1/chat/completions" ||
    endpoint === "multillm-image-chat-completions"
  );
};

const NAVY_NATIVE_RESERVED_PARAMETERS = new Set([
  "model",
  "prompt",
  "n",
  "size",
  "aspect_ratio",
  "response_format",
  "image_url",
  "negative_prompt",
  "quality",
  "style",
  "sync",
]);

const navyNativeParameters = (parameters: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(parameters).filter(
      ([key]) => !NAVY_NATIVE_RESERVED_PARAMETERS.has(key)
    )
  );

export async function POST(request: Request) {
  let body: ImageRequest;
  try {
    body = (await request.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const apiKey = resolveMultiLlmApiKey(request, body.apiKey);
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Missing MultiLLM API key. Add it in Settings or set MULTILLM_API_KEY on the server.",
      },
      { status: 400 }
    );
  }
  if (!body.prompt?.trim()) {
    return Response.json({ error: "prompt is required." }, { status: 400 });
  }

  let source: MultiLlmMediaSource;
  let model: string;
  try {
    ({ source, model } = parseMediaModelId(body.model));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid model." },
      { status: 400 }
    );
  }

  const numberOfImages = Math.min(
    4,
    Math.max(1, Math.floor(body.numberOfImages ?? 1))
  );
  const requestedImageInputs = [
    ...(body.imageDataUrl ? [body.imageDataUrl] : []),
    ...(Array.isArray(body.imageDataUrls) ? body.imageDataUrls : []),
  ].filter(Boolean);
  const imageInputs = sanitizeImageInputUrls(requestedImageInputs);
  if (!imageInputs) {
    return Response.json(
      {
        error:
          "Reference images must contain at most five HTTPS or valid image data URLs.",
      },
      { status: 400 }
    );
  }
  const usesLinkApiImageChat =
    source === "linkapi" && isLinkApiChatImageModel(model);
  const usesNavyImageChat =
    source === "navyai" &&
    (usesDeclaredImageChatEndpoint(body.modelEndpoint) ||
      isGeminiChatImageModel(model));
  const usesImageChat = usesLinkApiImageChat || usesNavyImageChat;
  const usesUnifiedImageGeneration = source === "aihubmix";
  const prompt =
    usesImageChat && body.negativePrompt?.trim()
      ? `${body.prompt.trim()}\n\nAvoid: ${body.negativePrompt.trim()}`
      : body.prompt.trim();
  const declaredModalities = Array.isArray(body.outputModalities)
    ? body.outputModalities
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value === "image" || value === "text")
    : [];
  const chatModalities = declaredModalities.includes("image")
    ? [
        "image",
        ...(declaredModalities.includes("text") ? ["text"] : []),
      ]
    : ["image", "text"];
  const parameters =
    body.parameters &&
    typeof body.parameters === "object" &&
    !Array.isArray(body.parameters)
      ? body.parameters
      : {};
  const payload: Record<string, unknown> = usesImageChat
    ? {
        ...parameters,
        model,
        messages: [
          {
            role: "user",
            content: imageInputs.length
              ? [
                  { type: "text", text: prompt },
                  ...imageInputs.map((url) => ({
                    type: "image_url",
                    image_url: { url },
                  })),
                ]
              : prompt,
          },
        ],
        modalities: chatModalities,
        ...(source === "linkapi" || numberOfImages > 1
          ? { n: numberOfImages }
          : {}),
        ...(body.size || body.aspectRatio
          ? {
              image_config: {
                ...(body.size ? { image_size: body.size } : {}),
                ...(body.aspectRatio
                  ? { aspect_ratio: body.aspectRatio }
                  : {}),
              },
            }
          : {}),
      }
    : source === "navyai"
      ? {
          ...navyNativeParameters(parameters),
          ...buildNavyImageGenerationPayload({
            model,
            prompt,
            size: body.size,
            numberOfImages,
            quality: body.quality,
            style: body.style,
            imageUrl:
              imageInputs.length === 0
                ? undefined
                : imageInputs.length === 1
                  ? imageInputs[0]
                  : imageInputs,
            negativePrompt: body.negativePrompt,
            sync: body.sync,
            responseFormat: "b64_json",
            aspectRatio: body.aspectRatio,
          }),
        }
      : {
          ...parameters,
          model: usesUnifiedImageGeneration ? `${source}:${model}` : model,
          prompt,
          n: numberOfImages,
          response_format: source === "linkapi" ? "url" : "b64_json",
          ...(body.size ? { size: body.size } : {}),
          ...(body.aspectRatio && source !== "linkapi"
            ? { aspect_ratio: body.aspectRatio }
            : {}),
          ...(body.negativePrompt && source !== "linkapi"
            ? { negative_prompt: body.negativePrompt }
            : {}),
          ...(body.quality && source === "linkapi"
            ? { quality: body.quality }
            : {}),
          ...(body.style && source === "linkapi"
            ? { style: body.style }
            : {}),
          ...(imageInputs.length && source !== "linkapi"
            ? {
                input_references:
                  imageInputs.length === 1 ? imageInputs[0] : imageInputs,
              }
            : {}),
        };

  const upstreamPath = usesUnifiedImageGeneration
    ? "/v1/images/generations"
    : `/${source}/v1/${
        usesImageChat ? "chat/completions" : "images/generations"
      }`;
  const response = await fetch(
    `${getMultiLlmProxyBaseUrl()}${upstreamPath}`,
    {
      method: "POST",
      headers: multiLlmAuthorizationHeaders(apiKey, "application/json"),
      body: JSON.stringify(payload),
      signal: request.signal,
    }
  );
  if (!response.ok) {
    return Response.json(
      await readUpstreamErrorDetails(
        response,
        "MultiLLM image generation failed.",
        [apiKey]
      ),
      { status: response.status }
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("image/")) {
    return Response.json({
      images: [
        {
          data: arrayBufferToBase64(await response.arrayBuffer()),
          mimeType: contentType.split(";")[0],
        },
      ],
    });
  }

  const responsePayload = (await response.json()) as unknown;
  const items = extractImageItems(responsePayload);
  if (items.length) {
    return Response.json({
      images: await materializeImages(items),
    });
  }

  const id = extractJobId(responsePayload);
  if (id && source === "navyai" && !usesNavyImageChat) {
    return Response.json(
      { id, source, status: jobStatus(responsePayload) },
      { status: 202 }
    );
  }

  return Response.json(
    { error: "The provider returned neither image data nor a job ID." },
    { status: 502 }
  );
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const source = url.searchParams.get("source");
  const apiKey = resolveMultiLlmApiKey(request);
  if (!apiKey || !id || source !== "navyai") {
    return Response.json(
      { error: "A NavyAI job id and MultiLLM API key are required." },
      { status: 400 }
    );
  }

  const response = await fetch(
    `${getMultiLlmProxyBaseUrl()}/navyai/v1/images/generations/${encodeURIComponent(
      id
    )}`,
    {
      headers: multiLlmAuthorizationHeaders(apiKey),
      cache: "no-store",
      signal: request.signal,
    }
  );
  if (!response.ok) {
    return Response.json(
      await readUpstreamErrorDetails(
        response,
        "Unable to fetch the image job.",
        [apiKey]
      ),
      { status: response.status }
    );
  }

  const payload = (await response.json()) as unknown;
  const status = jobStatus(payload);
  if (["failed", "error", "canceled", "cancelled"].includes(status)) {
    return Response.json({
      done: true,
      status,
      error: "Image generation failed.",
    });
  }

  const items = extractImageItems(payload);
  if (items.length) {
    return Response.json({
      done: true,
      status,
      images: await materializeImages(items),
    });
  }
  if (["completed", "complete", "success", "succeeded"].includes(status)) {
    return Response.json(
      {
        done: true,
        status,
        error: "Completed image job did not include image data.",
      },
      { status: 502 }
    );
  }

  return Response.json({ done: false, status });
}
