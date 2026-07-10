export const runtime = "edge";

import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";
import { NANOGPT_IMAGE_MODELS } from "@/lib/constants";

type ImageModelCapabilities = {
  supportedResolutions?: string[];
  maxOutputImages?: number;
  fixedOutputImages?: number;
  maxReferenceImages?: number;
  supportsReferenceImages?: boolean;
};

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
  modelCapabilities?: ImageModelCapabilities;
  compatibilityMode?: "legacy";
};

type ImagePayload = {
  data?: string;
  url?: string;
  mimeType: string;
  model?: string;
};

const MAX_OUTPUT_IMAGES = 20;
const MAX_INPUT_REFERENCES = 24;

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

const isSupportedImageReference = (value: string) => {
  if (value.startsWith("data:image/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

const normalizeInputReferences = (body: ImageRequest) => {
  const rawInputs: string[] = [];
  collectStringOrArray(body.imageDataUrl, rawInputs);
  collectStringOrArray(body.imageDataUrls, rawInputs);
  collectStringOrArray(body.imageUrl, rawInputs);
  collectStringOrArray(body.imageUrls, rawInputs);
  collectStringOrArray(body.image_url, rawInputs);
  collectInputReferences(body.input_references, rawInputs);

  const inputs: string[] = [];
  for (const input of rawInputs) {
    if (!isSupportedImageReference(input)) continue;
    if (!inputs.includes(input)) inputs.push(input);
  }
  return inputs;
};

const positiveInteger = (value: unknown) => {
  const number = asPositiveInt(value);
  return number && number > 0 ? number : undefined;
};

const resolveModelCapabilities = (
  model: string,
  value: ImageModelCapabilities | undefined,
): ImageModelCapabilities => {
  const fallback = NANOGPT_IMAGE_MODELS.find((entry) => entry.id === model);
  const maxOutputImages =
    positiveInteger(value?.maxOutputImages) ?? fallback?.maxOutputImages;
  const fixedOutputImages =
    positiveInteger(value?.fixedOutputImages) ?? fallback?.fixedOutputImages;
  return {
    supportedResolutions: Array.isArray(value?.supportedResolutions)
      ? value.supportedResolutions.filter(
          (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
        )
      : fallback?.supportedResolutions,
    maxOutputImages:
      maxOutputImages === undefined
        ? undefined
        : Math.min(maxOutputImages, MAX_OUTPUT_IMAGES),
    fixedOutputImages:
      fixedOutputImages === undefined
        ? undefined
        : Math.min(fixedOutputImages, MAX_OUTPUT_IMAGES),
    maxReferenceImages:
      typeof value?.maxReferenceImages === "number" &&
      Number.isFinite(value.maxReferenceImages) &&
      value.maxReferenceImages >= 0
        ? Math.min(Math.floor(value.maxReferenceImages), MAX_INPUT_REFERENCES)
        : fallback?.maxReferenceImages,
    supportsReferenceImages:
      typeof value?.supportsReferenceImages === "boolean"
        ? value.supportsReferenceImages
        : fallback?.supports?.referenceImages === true,
  };
};

const clampImageCount = (body: ImageRequest, capabilities: ImageModelCapabilities) => {
  const fixed = positiveInteger(capabilities.fixedOutputImages);
  if (fixed) return fixed;
  const requested = normalizeImageCount(body);
  const maximum = positiveInteger(capabilities.maxOutputImages) ?? 4;
  return Math.min(requested, maximum);
};

const clampInputReferences = (
  references: string[],
  capabilities: ImageModelCapabilities,
) => {
  if (!capabilities.supportsReferenceImages) return [];
  const maximum =
    typeof capabilities.maxReferenceImages === "number"
      ? Math.max(0, Math.floor(capabilities.maxReferenceImages))
      : 1;
  return references.slice(0, maximum);
};

const normalizeBilling = (data: unknown) => {
  const root = asRecord(data) ?? {};
  const billing: Record<string, number | string> = {};
  if (typeof root.cost === "number" && Number.isFinite(root.cost)) {
    billing.cost = root.cost;
  }
  if (typeof root.paymentSource === "string" && root.paymentSource) {
    billing.paymentSource = root.paymentSource;
  }
  if (
    typeof root.remainingBalance === "number" &&
    Number.isFinite(root.remainingBalance)
  ) {
    billing.remainingBalance = root.remainingBalance;
  }
  return Object.keys(billing).length ? billing : undefined;
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
      if (item.startsWith("https://")) {
        images.push({ url: item, mimeType: "image/png", model });
      } else {
        images.push({ data: item, mimeType: "image/png", model });
      }
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
  const capabilities = resolveModelCapabilities(model, body.modelCapabilities);
  if (
    size &&
    capabilities.supportedResolutions?.length &&
    !capabilities.supportedResolutions.includes(size)
  ) {
    return janitorAiJsonResponse(
      req,
      {
        error: `Resolution ${size} is not supported by ${model}.`,
        code: "unsupported_resolution",
        parameter: "resolution",
      },
      { status: 400 },
    );
  }
  const inputReferences = clampInputReferences(
    normalizeInputReferences(body),
    capabilities,
  );
  const normalizedPayload: Record<string, unknown> = {
    model,
    prompt,
    n: clampImageCount(body, capabilities),
  };
  if (size) normalizedPayload.resolution = size;
  if (typeof body.seed === "number" && Number.isFinite(body.seed)) {
    normalizedPayload.seed = Math.round(body.seed);
  }
  if (inputReferences.length) {
    normalizedPayload.input_references = inputReferences;
  }

  const useLegacyCompatibility = body.compatibilityMode === "legacy";
  const payload = useLegacyCompatibility
    ? {
        model,
        prompt,
        n: normalizedPayload.n,
        response_format: "b64_json",
        ...(size ? { size } : {}),
        ...(normalizedPayload.seed !== undefined
          ? { seed: normalizedPayload.seed }
          : {}),
        ...(inputReferences.length === 1 && inputReferences[0]?.startsWith("data:image/")
          ? { imageDataUrl: inputReferences[0] }
          : inputReferences.filter((entry) => entry.startsWith("data:image/")).length
            ? {
                imageDataUrls: inputReferences.filter((entry) =>
                  entry.startsWith("data:image/"),
                ),
              }
            : {}),
      }
    : normalizedPayload;

  const response = await fetch(
    useLegacyCompatibility
      ? "https://nano-gpt.com/v1/images/generations"
      : "https://nano-gpt.com/api/v1/images",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    },
  );
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

  const responsePayload = imageResponsePayload(
    images,
    model,
    includeUserscriptShape,
  );
  const billing = normalizeBilling(data);
  const dataRecord = asRecord(data);
  const requestId =
    response.headers.get("x-request-id") ??
    (typeof dataRecord?.requestId === "string"
      ? dataRecord.requestId
      : typeof dataRecord?.request_id === "string"
        ? dataRecord.request_id
        : undefined);
  return janitorAiJsonResponse(req, {
    ...responsePayload,
    ...(billing ? { billing } : {}),
    ...(requestId ? { requestId } : {}),
  });
}
