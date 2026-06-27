export const runtime = "edge";

import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";

type ImageRequest = {
  apiKey?: string;
  model?: string;
  prompt?: string;
  size?: string;
  resolution?: string;
  width?: number;
  height?: number;
  n?: number;
  nImages?: number;
  numberOfImages?: number;
  seed?: number | null;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  imageUrl?: string | string[];
  imageUrls?: string[];
  image_url?: string | string[];
  input_references?: Array<string | { image_url?: { url?: string } }>;
};

type ImagePayload = {
  data?: string;
  url?: string;
  mimeType: string;
  model?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asPositiveInt = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.round(value);
};

const normalizeSize = (body: ImageRequest) => {
  if (typeof body.size === "string" && body.size.trim()) {
    return body.size.trim();
  }
  if (typeof body.resolution === "string" && body.resolution.trim()) {
    return body.resolution.trim();
  }
  const width = asPositiveInt(body.width);
  const height = asPositiveInt(body.height);
  if (width && height) return `${width}x${height}`;
  return undefined;
};

const normalizeImageCount = (body: ImageRequest) =>
  asPositiveInt(body.nImages) ??
  asPositiveInt(body.numberOfImages) ??
  asPositiveInt(body.n) ??
  1;

const collectStringOrArray = (value: unknown, output: string[]) => {
  if (typeof value === "string" && value.trim()) {
    output.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringOrArray(item, output);
  }
};

const collectInputReferences = (value: unknown, output: string[]) => {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      collectStringOrArray(item, output);
      continue;
    }
    const record = asRecord(item);
    const imageUrl = asRecord(record?.image_url);
    collectStringOrArray(imageUrl?.url, output);
  }
};

const hasArrayImageInput = (body: ImageRequest) =>
  Array.isArray(body.imageDataUrls) ||
  Array.isArray(body.imageUrl) ||
  Array.isArray(body.imageUrls) ||
  Array.isArray(body.image_url) ||
  Array.isArray(body.input_references);

const normalizeDataUrlInputs = (body: ImageRequest) => {
  const rawInputs: string[] = [];
  collectStringOrArray(body.imageDataUrl, rawInputs);
  collectStringOrArray(body.imageDataUrls, rawInputs);
  collectStringOrArray(body.imageUrl, rawInputs);
  collectStringOrArray(body.imageUrls, rawInputs);
  collectStringOrArray(body.image_url, rawInputs);
  collectInputReferences(body.input_references, rawInputs);

  const inputs: string[] = [];
  for (const input of rawInputs) {
    if (!input.startsWith("data:image/")) continue;
    if (!inputs.includes(input)) inputs.push(input);
  }
  return {
    inputs,
    preferArray: hasArrayImageInput(body),
  };
};

const normalizeImages = (data: unknown, model: string) => {
  const root = asRecord(data) ?? {};
  const candidates = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.images)
      ? root.images
      : [];
  const images: ImagePayload[] = [];

  for (const item of candidates) {
    if (typeof item === "string") {
      images.push({ data: item, mimeType: "image/png", model });
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const mimeType =
      typeof record.mimeType === "string"
        ? record.mimeType
        : typeof record.mime_type === "string"
          ? record.mime_type
          : "image/png";
    const data =
      typeof record.b64_json === "string"
        ? record.b64_json
        : typeof record.data === "string"
          ? record.data
          : typeof record.image === "string"
            ? record.image
            : "";
    if (data) {
      images.push({ data, mimeType, model });
      continue;
    }
    if (typeof record.url === "string" && record.url) {
      images.push({ url: record.url, mimeType, model });
    }
  }

  return images;
};

const imageResponsePayload = (
  images: ImagePayload[],
  model: string,
  includeUserscriptShape: boolean
) => {
  if (!includeUserscriptShape) return { images };
  const firstImage = images[0];
  return {
    ...(firstImage?.data
      ? {
          imageUrl: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          model: firstImage.model ?? model,
        }
      : firstImage?.url
        ? { imageUrl: firstImage.url, model: firstImage.model ?? model }
        : { model }),
    images,
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

  const apiKey = getProviderApiKey("nanogpt", req, body);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req, body);

  if (!apiKey || !model || !prompt) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing required fields." },
      { status: 400 }
    );
  }

  const size = normalizeSize(body);
  const { inputs: inputImages, preferArray: preferArrayInputImages } =
    normalizeDataUrlInputs(body);
  const payload: Record<string, unknown> = {
    model,
    prompt,
    n: normalizeImageCount(body),
    response_format: "b64_json",
  };
  if (size) payload.size = size;
  if (typeof body.seed === "number" && Number.isFinite(body.seed)) {
    payload.seed = Math.round(body.seed);
  }
  if (inputImages.length === 1 && !preferArrayInputImages) {
    payload.imageDataUrl = inputImages[0];
  } else if (inputImages.length > 1) {
    payload.imageDataUrls = inputImages;
  } else if (inputImages.length === 1) {
    payload.imageDataUrls = inputImages;
  }

  const response = await fetch("https://nano-gpt.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await jsonOrNull(response);

  if (!response.ok) {
    return janitorAiJsonResponse(
      req,
      { error: providerErrorMessage(data, "Image generation failed.", [apiKey]) },
      { status: response.status }
    );
  }

  const images = normalizeImages(data, model);
  if (!images.length) {
    return janitorAiJsonResponse(
      req,
      { error: "No images returned by NanoGPT." },
      { status: 502 }
    );
  }

  return janitorAiJsonResponse(
    req,
    imageResponsePayload(images, model, includeUserscriptShape)
  );
}
