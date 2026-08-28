import { POST as chutesImagePost } from "@/app/api/chutes/image/route";
import { POST as geminiImagePost } from "@/app/api/gemini/image/route";
import { POST as nanoGptImagePost } from "@/app/api/nanogpt/image/route";
import { GET as navyImageGet, POST as navyImagePost } from "@/app/api/navy/image/route";
import { POST as openRouterImagePost } from "@/app/api/openrouter/image/route";
import {
  getProviderApiKey,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  providerErrorMessage,
} from "@/lib/api-safety";
import {
  CHUTES_IMAGE_MODELS,
  DEFAULT_MODELS,
  GEMINI_IMAGE_MODELS,
  NANOGPT_IMAGE_MODELS,
  NAVY_IMAGE_MODELS,
  OPENROUTER_IMAGE_MODELS,
  type Provider,
} from "@/lib/constants";
import {
  NAVY_JOB_POLL_INTERVAL_MS,
  NAVY_JOB_POLL_MAX_ATTEMPTS,
  prepareImageModelRequests,
  resolveNavyJobPollDelayMs,
  resolveActiveImageToolModels,
} from "@/lib/studio-generation";
import { IMAGE_MIME_TYPES, parseDataUrl } from "@/lib/studio-validation";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";

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
type JanitorAiProvider = Exclude<Provider, "multillm">;

const PROVIDER_MODELS: Record<JanitorAiProvider, string[]> = {
  gemini: GEMINI_IMAGE_MODELS.map((model) => model.id),
  navy: NAVY_IMAGE_MODELS.map((model) => model.id),
  chutes: CHUTES_IMAGE_MODELS.map((model) => model.id),
  openrouter: OPENROUTER_IMAGE_MODELS.map((model) => model.id),
  nanogpt: NANOGPT_IMAGE_MODELS.map((model) => model.id),
};

const PROVIDER_HANDLERS: Record<JanitorAiProvider, ProviderHandler> = {
  gemini: geminiImagePost,
  navy: navyImagePost,
  chutes: chutesImagePost,
  openrouter: openRouterImagePost,
  nanogpt: nanoGptImagePost,
};

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

const jsonResponse = (req: Request, payload: unknown, status = 200) =>
  janitorAiJsonResponse(req, payload, { status });

const providerForModel = (model: string): JanitorAiProvider => {
  if (PROVIDER_MODELS.gemini.includes(model)) return "gemini";
  if (PROVIDER_MODELS.navy.includes(model)) return "navy";
  if (PROVIDER_MODELS.openrouter.includes(model)) return "openrouter";
  if (PROVIDER_MODELS.chutes.includes(model)) return "chutes";
  if (PROVIDER_MODELS.nanogpt.includes(model)) return "nanogpt";
  if (model.startsWith("imagen-") || model.startsWith("gemini-")) return "gemini";
  if (model.includes("/")) return "openrouter";
  if (/^(?:flux|dall-e|gpt-image|nano-banana)/i.test(model)) return "navy";
  return "chutes";
};

const availableModelsForProvider = (
  provider: JanitorAiProvider,
  model: string
) => {
  const models = PROVIDER_MODELS[provider];
  return models.includes(model) ? models : [model, ...models];
};

const buildBaseBody = (
  provider: JanitorAiProvider,
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

  if (provider === "nanogpt") {
    return {
      size: width && height ? `${width}x${height}` : undefined,
      seed,
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

const imageResultPayload = (images: ImagePayload[]) => {
  const firstImage = images[0];
  return {
    ...(firstImage
      ? {
          imageUrl: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          model: firstImage.model,
        }
      : {}),
    images,
  };
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
  let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
  for (let attempt = 0; attempt < NAVY_JOB_POLL_MAX_ATTEMPTS; attempt += 1) {
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
    delayMs = resolveNavyJobPollDelayMs({
      payload,
      responseStatus: response.status,
      currentDelayMs: delayMs,
    });
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
  provider: JanitorAiProvider;
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
  return janitorAiOptionsResponse(req);
}

export async function POST(req: Request) {
  let body: JanitorAiImageRequest;
  try {
    body = await readJsonRequestObject<JanitorAiImageRequest>(req);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return jsonResponse(req, { error: details.error }, details.status);
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

  const requestedModel = normalizedString(body.model);
  const provider = requestedModel ? providerForModel(requestedModel) : "chutes";
  const apiKey = getProviderApiKey(
    provider,
    req,
    body as Record<string, unknown>
  );
  if (!apiKey) {
    return jsonResponse(req, { error: "Missing API key." }, 400);
  }

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
    return jsonResponse(req, imageResultPayload(images));
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
