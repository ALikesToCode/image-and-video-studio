import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorDetails,
} from "@/lib/api-safety";
import { NANOGPT_IMAGE_MODELS } from "@/lib/constants";
import {
  normalizeInlineMediaData,
  sanitizeMediaUrl,
} from "@/lib/media-url";
import {
  IMAGE_MIME_TYPES,
  isAllowedMimeType,
  normalizeMimeType,
} from "@/lib/studio-validation";

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
  aspectRatio?: string;
  aspect_ratio?: string;
  quality?: string;
  outputFormat?: string;
  output_format?: string;
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
  parameters?: Record<string, unknown>;
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
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asPositiveInt = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.round(value);
};

const parameterRecord = (body: ImageRequest) =>
  body.parameters &&
  typeof body.parameters === "object" &&
  !Array.isArray(body.parameters)
    ? body.parameters
    : {};

const normalizeShortString = (value: unknown, maxLength = 64) =>
  typeof value === "string" && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : undefined;

const normalizeSize = (body: ImageRequest) => {
  if (typeof body.size === "string" && body.size.trim()) {
    return body.size.trim();
  }
  if (typeof body.resolution === "string" && body.resolution.trim()) {
    return body.resolution.trim();
  }
  const catalogResolution = normalizeShortString(
    parameterRecord(body).resolution,
    64,
  );
  if (catalogResolution) return catalogResolution;
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

const normalizeInputReferences = (body: ImageRequest) => {
  const rawInputs: string[] = [];
  collectStringOrArray(body.imageDataUrl, rawInputs);
  collectStringOrArray(body.imageDataUrls, rawInputs);
  collectStringOrArray(body.imageUrl, rawInputs);
  collectStringOrArray(body.imageUrls, rawInputs);
  collectStringOrArray(body.image_url, rawInputs);
  collectInputReferences(body.input_references, rawInputs);
  if (rawInputs.length > MAX_INPUT_REFERENCES) return null;

  const inputs: string[] = [];
  for (const input of rawInputs) {
    const safeInput = sanitizeMediaUrl(input, {
      kind: "image",
      allowBlob: false,
      allowData: true,
      maxBytes: MAX_IMAGE_BYTES,
    });
    if (!safeInput) return null;
    if (!inputs.includes(safeInput)) inputs.push(safeInput);
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

  const safeMimeType = (value: unknown) => {
    const mimeType = normalizeMimeType(value);
    if (!mimeType) return "image/png";
    return isAllowedMimeType(mimeType, IMAGE_MIME_TYPES) ? mimeType : null;
  };
  const addValue = (value: unknown, mimeType: string) => {
    const inline = normalizeInlineMediaData(value, {
      kind: "image",
      mimeType,
      maxBytes: MAX_IMAGE_BYTES,
    });
    if (inline) {
      images.push({ data: inline.data, mimeType: inline.mimeType, model });
      return true;
    }
    const url = sanitizeMediaUrl(value, {
      kind: "image",
      allowBlob: false,
      allowData: false,
    });
    if (url) {
      images.push({ url, mimeType, model });
      return true;
    }
    return false;
  };

  for (const item of candidates.slice(0, MAX_OUTPUT_IMAGES)) {
    if (typeof item === "string") {
      addValue(item, "image/png");
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const mimeType = safeMimeType(record.mimeType ?? record.mime_type);
    if (!mimeType) continue;
    const data =
      typeof record.b64_json === "string"
        ? record.b64_json
        : typeof record.data === "string"
          ? record.data
          : typeof record.image === "string"
            ? record.image
            : "";
    if (data && addValue(data, mimeType)) continue;
    addValue(record.url, mimeType);
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
  const normalizedInputReferences = normalizeInputReferences(body);
  if (!normalizedInputReferences) {
    return janitorAiJsonResponse(
      req,
      {
        error:
          "Image references must be bounded HTTPS or valid image data URLs.",
      },
      { status: 400 }
    );
  }
  const inputReferences = clampInputReferences(
    normalizedInputReferences,
    capabilities,
  );
  const normalizedPayload: Record<string, unknown> = {
    model,
    prompt,
    n: clampImageCount(body, capabilities),
  };
  if (size) normalizedPayload.resolution = size;
  const catalogParameters = parameterRecord(body);
  const aspectRatio = normalizeShortString(
    body.aspectRatio ?? body.aspect_ratio ?? catalogParameters.aspect_ratio,
    32,
  );
  const quality = normalizeShortString(body.quality ?? catalogParameters.quality);
  const outputFormat = normalizeShortString(
    body.outputFormat ?? body.output_format ?? catalogParameters.output_format,
    32,
  );
  const seed =
    typeof body.seed === "number" && Number.isFinite(body.seed)
      ? body.seed
      : typeof catalogParameters.seed === "number" &&
          Number.isFinite(catalogParameters.seed)
        ? catalogParameters.seed
        : undefined;
  if (aspectRatio) normalizedPayload.aspect_ratio = aspectRatio;
  if (quality) normalizedPayload.quality = quality;
  if (outputFormat) normalizedPayload.output_format = outputFormat;
  if (seed !== undefined) {
    normalizedPayload.seed = Math.round(seed);
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
      providerErrorDetails(data, "Image generation failed.", {
        knownSecrets: [apiKey],
        response,
      }),
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
