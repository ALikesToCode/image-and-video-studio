export const runtime = "edge";

import { POST as chutesImagePost } from "@/app/api/chutes/image/route";
import { POST as geminiImagePost } from "@/app/api/gemini/image/route";
import { GET as navyImageGet, POST as navyImagePost } from "@/app/api/navy/image/route";
import { POST as openRouterImagePost } from "@/app/api/openrouter/image/route";
import { getUserApiKey, providerErrorMessage } from "@/lib/api-safety";
import {
  CHUTES_IMAGE_MODELS,
  DEFAULT_MODELS,
  GEMINI_IMAGE_MODELS,
  NAVY_IMAGE_MODELS,
  OPENROUTER_IMAGE_MODELS,
  type Provider,
} from "@/lib/constants";
import {
  prepareImageModelRequests,
  resolveActiveImageToolModels,
} from "@/lib/studio-generation";
import { IMAGE_MIME_TYPES, parseDataUrl } from "@/lib/studio-validation";

type JanitorAiImageRequest = {
  apiKey?: string;
  source?: string;
  mode?: string;
  action?: string;
  prompt?: string;
  model?: string;
  provider?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  returnImage?: boolean;
  responseFormat?: string;
  imagePipelineEnabled?: boolean;
  negativePrompt?: string;
};

type ImagePayload = {
  data: string;
  mimeType: string;
  model: string;
};

type PassthroughImageResult = { imageUrl: string } | { dataUrl: string };

type ProviderHandler = (req: Request) => Promise<Response>;

const PROVIDER_MODELS: Record<Provider, string[]> = {
  gemini: GEMINI_IMAGE_MODELS.map((model) => model.id),
  navy: NAVY_IMAGE_MODELS.map((model) => model.id),
  chutes: CHUTES_IMAGE_MODELS.map((model) => model.id),
  openrouter: OPENROUTER_IMAGE_MODELS.map((model) => model.id),
};

const PROVIDER_HANDLERS: Record<Provider, ProviderHandler> = {
  gemini: geminiImagePost,
  navy: navyImagePost,
  chutes: chutesImagePost,
  openrouter: openRouterImagePost,
};

const CORS_ALLOWED_SUFFIXES = ["janitorai.com"];

const normalizedString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizedLower = (value: unknown) => normalizedString(value).toLowerCase();

const positiveInteger = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
};

const integer = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : undefined;

const isAllowedCorsOrigin = (origin: string) => {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return CORS_ALLOWED_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
};

const corsHeaders = (req: Request) => {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-user-api-key",
    Vary: "Origin",
  });
  const origin = req.headers.get("origin");
  if (origin && isAllowedCorsOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
};

const jsonResponse = (req: Request, payload: unknown, status = 200) =>
  Response.json(payload, { status, headers: corsHeaders(req) });

const providerForModel = (model: string): Provider => {
  if (PROVIDER_MODELS.gemini.includes(model)) return "gemini";
  if (PROVIDER_MODELS.navy.includes(model)) return "navy";
  if (PROVIDER_MODELS.openrouter.includes(model)) return "openrouter";
  if (PROVIDER_MODELS.chutes.includes(model)) return "chutes";
  if (model.startsWith("imagen-") || model.startsWith("gemini-")) return "gemini";
  if (model.includes("/")) return "openrouter";
  if (/^(?:flux|dall-e|gpt-image|nano-banana)/i.test(model)) return "navy";
  return "chutes";
};

const availableModelsForProvider = (provider: Provider, model: string) => {
  const models = PROVIDER_MODELS[provider];
  return models.includes(model) ? models : [model, ...models];
};

const buildBaseBody = (
  provider: Provider,
  body: JanitorAiImageRequest
): Record<string, unknown> => {
  const width = positiveInteger(body.width);
  const height = positiveInteger(body.height);
  const steps = positiveInteger(body.steps);
  const seed = integer(body.seed);

  if (provider === "chutes") {
    return {
      width,
      height,
      numInferenceSteps: steps,
      seed,
    };
  }

  if (provider === "navy") {
    return {
      size: width && height ? `${width}x${height}` : undefined,
      seed,
      responseFormat: normalizedString(body.responseFormat) || undefined,
      sync: false,
    };
  }

  return {};
};

const parseImagePayload = (
  value: unknown,
  fallbackMimeType: string,
  model: string
): ImagePayload | null => {
  const parsed = parseDataUrl(value, IMAGE_MIME_TYPES);
  if (parsed) {
    return { data: parsed.data, mimeType: parsed.mimeType, model };
  }
  if (typeof value !== "string" || !value) return null;
  return { data: value, mimeType: fallbackMimeType, model };
};

const normalizeImages = (payload: unknown, model: string) => {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const rawImages = Array.isArray(record.images) ? record.images : [];
  const images: ImagePayload[] = [];

  for (const rawImage of rawImages) {
    if (!rawImage || typeof rawImage !== "object") continue;
    const image = rawImage as Record<string, unknown>;
    const imageModel = normalizedString(image.model) || model;
    const mimeType = normalizedString(image.mimeType) || "image/png";
    const parsed = parseImagePayload(image.data, mimeType, imageModel);
    if (parsed) images.push(parsed);
  }

  return images;
};

const passthroughSingleImageResult = (
  payload: unknown
): PassthroughImageResult | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const imageUrl = normalizedString(record.imageUrl);
  if (imageUrl) return { imageUrl };
  const dataUrl = normalizedString(record.dataUrl);
  if (dataUrl) return { dataUrl };
  return null;
};

const providerRequest = (
  path: string,
  apiKey: string,
  body: Record<string, unknown>
) =>
  new Request(`https://studio.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

const pollNavyImageJob = async (apiKey: string, id: string) => {
  let delayMs = 2_000;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await navyImageGet(
      new Request(
        `https://studio.local/api/navy/image?id=${encodeURIComponent(id)}`,
        {
          headers: { "x-user-api-key": apiKey },
        }
      )
    );
    const payload = await response.json();
    if (!response.ok) {
      return { response, payload };
    }
    if (payload?.done) {
      return { response, payload };
    }
    delayMs =
      typeof payload?.retryAfterMs === "number" &&
      Number.isFinite(payload.retryAfterMs)
        ? Math.min(Math.max(payload.retryAfterMs, 1_000), 30_000)
        : delayMs;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return {
    response: new Response(null, { status: 504 }),
    payload: { error: "Timed out waiting for image generation." },
  };
};

const invokeProvider = async ({
  provider,
  apiKey,
  body,
}: {
  provider: Provider;
  apiKey: string;
  body: Record<string, unknown>;
}) => {
  const handler = PROVIDER_HANDLERS[provider];
  let response = await handler(
    providerRequest(`/api/${provider}/image`, apiKey, body)
  );
  let payload = await response.json();

  if (provider === "navy" && response.ok && typeof payload?.id === "string") {
    ({ response, payload } = await pollNavyImageJob(apiKey, payload.id));
  }

  return { response, payload };
};

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  let body: JanitorAiImageRequest;
  try {
    body = (await req.json()) as JanitorAiImageRequest;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON payload." }, 400);
  }

  if (normalizedLower(body.source) !== "janitorai") {
    return jsonResponse(req, { error: "Invalid source." }, 400);
  }
  if (normalizedLower(body.mode) !== "image") {
    return jsonResponse(req, { error: "Invalid mode." }, 400);
  }
  if (body.action !== undefined && normalizedLower(body.action) !== "generate") {
    return jsonResponse(req, { error: "Invalid action." }, 400);
  }
  if (body.provider !== undefined && normalizedLower(body.provider) !== "janitorai") {
    return jsonResponse(req, { error: "Invalid provider." }, 400);
  }

  const prompt = normalizedString(body.prompt);
  if (!prompt) {
    return jsonResponse(req, { error: "Prompt required." }, 400);
  }

  const apiKey = getUserApiKey(req, body as Record<string, unknown>);
  if (!apiKey) {
    return jsonResponse(req, { error: "Missing API key." }, 400);
  }

  const requestedModel = normalizedString(body.model);
  const provider = requestedModel ? providerForModel(requestedModel) : "chutes";
  const fallbackModel = requestedModel || DEFAULT_MODELS[provider].image;
  const availableModels = availableModelsForProvider(provider, fallbackModel);
  const models = resolveActiveImageToolModels({
    pipelineEnabled: Boolean(body.imagePipelineEnabled),
    preferredModels: [],
    fallbackModel,
    availableModels,
  });

  if (!models.length) {
    return jsonResponse(req, { error: "No image models are available." }, 400);
  }

  const imageRequests = prepareImageModelRequests({
    models,
    baseBody: buildBaseBody(provider, body),
    prompt,
    negativePrompt: normalizedString(body.negativePrompt) || undefined,
  });

  const images: ImagePayload[] = [];
  let passthroughResult: PassthroughImageResult | null = null;

  for (const imageRequest of imageRequests) {
    const { response, payload } = await invokeProvider({
      provider,
      apiKey,
      body: imageRequest.body,
    });

    if (!response.ok) {
      return jsonResponse(
        req,
        { error: providerErrorMessage(payload, "Image generation failed.", [apiKey]) },
        response.status
      );
    }

    images.push(...normalizeImages(payload, imageRequest.model));
    passthroughResult = passthroughResult ?? passthroughSingleImageResult(payload);
  }

  if (images.length) {
    return jsonResponse(req, { images });
  }
  if (passthroughResult) {
    return jsonResponse(req, passthroughResult);
  }

  return jsonResponse(
    req,
    { error: "No images were returned by the model." },
    502
  );
}
