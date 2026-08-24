import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";

type ImageRequest = {
  apiKey?: string;
  prompt: string;
  model?: string;
  negativePrompt?: string;
  guidanceScale?: number;
  width?: number;
  height?: number;
  numInferenceSteps?: number;
  resolution?: string;
  seed?: number | null;
};

type ImagePayload = {
  data: string;
  mimeType: string;
  model?: string;
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

const parseDataUrl = (value: string) => {
  const match = /^data:([^;]+);base64,(.*)$/.exec(value);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
};

const extractFromJson = (data: unknown) => {
  const images: ImagePayload[] = [];
  const urls: string[] = [];
  const record = toRecord(data) ?? {};
  const addBase64 = (value: unknown, mimeType?: string) => {
    if (typeof value !== "string") return;
    const dataUrl = parseDataUrl(value);
    if (dataUrl) {
      images.push({ data: dataUrl.data, mimeType: dataUrl.mimeType });
      return;
    }
    images.push({ data: value, mimeType: mimeType ?? "image/png" });
  };
  const addUrl = (value: unknown) => {
    if (typeof value === "string") urls.push(value);
  };

  const mimeType =
    typeof record.mime_type === "string"
      ? record.mime_type
      : typeof record.mimeType === "string"
        ? record.mimeType
        : undefined;
  addBase64(record.image, mimeType);
  addBase64(record.image_base64, mimeType);
  addBase64(record.imageBase64, mimeType);
  addBase64(record.output, mimeType);
  addUrl(record.url);
  addUrl(record.output_url);
  addUrl(record.outputUrl);

  const candidates = Array.isArray(record.images)
    ? record.images
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.outputs)
        ? record.outputs
        : [];
  if (Array.isArray(candidates)) {
    for (const item of candidates) {
      if (typeof item === "string") {
        if (item.startsWith("http")) {
          addUrl(item);
        } else {
          addBase64(item);
        }
        continue;
      }
      const candidate = toRecord(item);
      if (!candidate) continue;
      const candidateMimeType =
        typeof candidate.mime_type === "string"
          ? candidate.mime_type
          : typeof candidate.mimeType === "string"
            ? candidate.mimeType
            : undefined;
      addBase64(
        candidate.image ?? candidate.base64 ?? candidate.b64_json ?? candidate.data,
        candidateMimeType
      );
      addUrl(candidate.url ?? candidate.output_url ?? candidate.outputUrl);
    }
  }

  return { images, urls };
};

const downloadImage = async (url: string) => {
  const response = await safeFetchExternalMedia(url, {
    allowedHosts: ["chutes.ai", ".chutes.ai"],
    allowedContentTypes: ["image/"],
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: 30_000,
    allowRedirects: true,
  });
  const contentType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  return {
    data: arrayBufferToBase64(buffer),
    mimeType: contentType.split(";")[0] ?? "image/png",
  };
};

const asPositiveInt = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.round(value);
};

const resolveHiDreamResolution = (body: ImageRequest) => {
  if (typeof body.resolution === "string" && body.resolution.trim()) {
    return body.resolution.trim();
  }
  const width = asPositiveInt(body.width) ?? 1024;
  const height = asPositiveInt(body.height) ?? 1024;
  return `${width}x${height}`;
};

const imageResponsePayload = (
  images: ImagePayload[],
  model: string,
  includeUserscriptShape: boolean
) => {
  const payloadImages = images.map((image) =>
    includeUserscriptShape ? { ...image, model: image.model ?? model } : image
  );
  const firstImage = payloadImages[0];
  if (!includeUserscriptShape) return { images: payloadImages };
  return {
    ...(firstImage
      ? {
          imageUrl: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          model: firstImage.model,
        }
      : { model }),
    images: payloadImages,
  };
};

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

  const { prompt } = body;
  const apiKey = getProviderApiKey("chutes", req, body);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req, body);
  if (!apiKey || !prompt) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing required fields." },
      { status: 400 }
    );
  }

  const model = body.model ?? "z-image-turbo";
  const normalizedModel = model.toLowerCase();
  const isZImageTurbo = normalizedModel === "z-image-turbo";
  const isHiDream =
    normalizedModel === "chutes-hidream" || normalizedModel === "hidream";

  let url = "https://image.chutes.ai/generate";
  let payload: Record<string, unknown> = {
    model,
    prompt,
    negative_prompt: body.negativePrompt,
    guidance_scale: body.guidanceScale,
    width: body.width,
    height: body.height,
    num_inference_steps: body.numInferenceSteps,
  };

  if (isZImageTurbo) {
    url = "https://chutes-z-image-turbo.chutes.ai/generate";
    payload = { prompt };
  } else if (isHiDream) {
    url = "https://chutes-hidream.chutes.ai/generate";
    payload = {
      seed: body.seed ?? null,
      prompt,
      resolution: resolveHiDreamResolution(body),
      guidance_scale: body.guidanceScale,
      num_inference_steps: body.numInferenceSteps,
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const data = await jsonOrNull(response);
      return janitorAiJsonResponse(
        req,
        { error: providerErrorMessage(data, "Image generation failed.", [apiKey]) },
        { status: response.status }
      );
    }
    return janitorAiJsonResponse(
      req,
      { error: "Image generation failed." },
      { status: response.status }
    );
  }

  if (contentType.startsWith("image/")) {
    const buffer = await response.arrayBuffer();
    return janitorAiJsonResponse(
      req,
      imageResponsePayload(
        [
          {
            data: arrayBufferToBase64(buffer),
            mimeType: contentType.split(";")[0] ?? "image/png",
          },
        ],
        model,
        includeUserscriptShape
      )
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return janitorAiJsonResponse(
      req,
      { error: "Unexpected response from Chutes." },
      { status: 502 }
    );
  }
  const { images, urls } = extractFromJson(data);

  if (images.length) {
    return janitorAiJsonResponse(
      req,
      imageResponsePayload(images, model, includeUserscriptShape)
    );
  }

  if (urls.length) {
    const downloaded: ImagePayload[] = [];
    for (const url of urls) {
      downloaded.push(await downloadImage(url));
    }
    return janitorAiJsonResponse(
      req,
      imageResponsePayload(downloaded, model, includeUserscriptShape)
    );
  }

  return janitorAiJsonResponse(
    req,
    { error: "No images were returned by the model." },
    { status: 502 }
  );
}
