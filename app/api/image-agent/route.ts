export const runtime = "edge";

import { POST as janitorImagePost } from "@/app/api/janitorai/image/route";
import {
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  providerErrorMessage,
} from "@/lib/api-safety";
import { IMAGE_MIME_TYPES, parseDataUrl } from "@/lib/studio-validation";

type ImageAgentMessage = {
  role?: unknown;
  content?: unknown;
};

type ImageAgentRequest = {
  source?: string;
  provider?: string;
  action?: string;
  mode?: string;
  view?: string;
  prompt?: string;
  messages?: ImageAgentMessage[];
  models?: string[];
  model?: string;
  width?: number;
  height?: number;
  seed?: number | null;
  steps?: number;
  maxImages?: number;
  returnImages?: boolean;
  returnImage?: boolean;
  responseFormat?: string;
  imagePipelineEnabled?: boolean;
  negativePrompt?: string;
  promptAgentModel?: string;
};

type AgentImage = {
  imageUrl: string;
  model: string;
  seedUsed?: number | null;
  prompt: string;
  generationTag: string;
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

const integerOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : value === null
      ? null
      : undefined;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const promptFromMessages = (messages: unknown) => {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = toRecord(messages[index]);
    if (!message || normalizedLower(message.role) !== "user") continue;
    const content = normalizedString(message.content);
    if (content) return content;
  }
  return "";
};

const resolvePrompt = (body: ImageAgentRequest) =>
  normalizedString(body.prompt) || promptFromMessages(body.messages);

const uniqueModels = (values: unknown[]) => {
  const models: string[] = [];
  for (const value of values) {
    const model = normalizedString(value);
    if (!model || models.includes(model)) continue;
    models.push(model);
  }
  return models;
};

const resolveModels = (body: ImageAgentRequest) => {
  const pipelineModels =
    body.imagePipelineEnabled && Array.isArray(body.models) ? body.models : [];
  return uniqueModels([...pipelineModels, body.model]).length
    ? uniqueModels([...pipelineModels, body.model])
    : ["z-image-turbo"];
};

const dataUrlFromBase64 = (data: string, mimeType: string) =>
  `data:${mimeType};base64,${data.replace(/\s/g, "")}`;

const directImageUrl = (value: unknown) => {
  const parsed = parseDataUrl(value, IMAGE_MIME_TYPES);
  if (parsed) return parsed.dataUrl;
  const text = normalizedString(value);
  if (/^https?:\/\//i.test(text)) return text;
  return "";
};

const base64ImageUrl = (value: unknown, mimeType: string) => {
  const parsed = parseDataUrl(value, IMAGE_MIME_TYPES);
  if (parsed) return parsed.dataUrl;
  const text = normalizedString(value);
  return text ? dataUrlFromBase64(text, mimeType || "image/png") : "";
};

const recordMimeType = (record: Record<string, unknown>) =>
  normalizedString(record.mimeType) ||
  normalizedString(record.mime_type) ||
  "image/png";

const extractImageUrls = (payload: unknown, fallbackModel: string) => {
  const urls: Array<{ imageUrl: string; model: string }> = [];
  const seen = new Set<string>();

  const add = (imageUrl: string, model: string) => {
    if (!imageUrl || seen.has(imageUrl)) return;
    seen.add(imageUrl);
    urls.push({ imageUrl, model: model || fallbackModel });
  };

  const visit = (value: unknown, model = fallbackModel, mimeType = "image/png") => {
    if (typeof value === "string") {
      add(base64ImageUrl(value, mimeType), model);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, model, mimeType);
      return;
    }

    const record = toRecord(value);
    if (!record) return;

    const nextModel = normalizedString(record.model) || model;
    const nextMimeType = recordMimeType(record) || mimeType;

    for (const key of ["imageUrl", "image_url", "dataUrl", "url"]) {
      add(directImageUrl(record[key]), nextModel);
    }
    for (const key of ["image", "result", "output"]) {
      const direct = directImageUrl(record[key]);
      if (direct) {
        add(direct, nextModel);
      } else {
        visit(record[key], nextModel, nextMimeType);
      }
    }
    for (const key of ["data", "b64_json", "base64", "image_base64"]) {
      if (typeof record[key] === "string") {
        add(base64ImageUrl(record[key], nextMimeType), nextModel);
      } else {
        visit(record[key], nextModel, nextMimeType);
      }
    }
    for (const key of [
      "images",
      "results",
      "outputs",
      "generations",
      "artifacts",
    ]) {
      visit(record[key], nextModel, nextMimeType);
    }
  };

  visit(payload);
  return urls;
};

const forwardHeaders = (req: Request) => {
  const headers = new Headers({
    "content-type": "application/json",
    "x-janitorai-source": req.headers.get("x-janitorai-source") ?? "userscript",
  });
  for (const key of ["x-user-api-key", "authorization", "origin"]) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
};

const invokeExistingImagePipeline = async ({
  req,
  body,
  model,
  prompt,
}: {
  req: Request;
  body: ImageAgentRequest;
  model: string;
  prompt: string;
}) =>
  janitorImagePost(
    new Request("https://studio.local/api/janitorai/image", {
      method: "POST",
      headers: forwardHeaders(req),
      body: JSON.stringify({
        source: "janitorai",
        provider: "janitorai",
        action: "generate",
        mode: "image",
        prompt,
        model,
        width: positiveInteger(body.width),
        height: positiveInteger(body.height),
        steps: positiveInteger(body.steps),
        seed: integerOrNull(body.seed),
        returnImage: true,
        responseFormat: normalizedString(body.responseFormat) || "json",
        imagePipelineEnabled: false,
        negativePrompt: normalizedString(body.negativePrompt) || undefined,
        promptAgentModel: normalizedString(body.promptAgentModel) || undefined,
      }),
    })
  );

export async function OPTIONS(req: Request) {
  return janitorAiOptionsResponse(req);
}

export async function POST(req: Request) {
  let body: ImageAgentRequest;
  try {
    body = (await req.json()) as ImageAgentRequest;
  } catch {
    return janitorAiJsonResponse(
      req,
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  if (normalizedLower(body.source) !== "janitorai") {
    return janitorAiJsonResponse(req, { error: "Invalid source." }, { status: 400 });
  }
  if (normalizedLower(body.provider) !== "image-agent") {
    return janitorAiJsonResponse(
      req,
      { error: "Invalid provider." },
      { status: 400 }
    );
  }
  if (normalizedLower(body.action) !== "generate") {
    return janitorAiJsonResponse(req, { error: "Invalid action." }, { status: 400 });
  }
  if (normalizedLower(body.mode) !== "image-agent") {
    return janitorAiJsonResponse(req, { error: "Invalid mode." }, { status: 400 });
  }
  if (body.view !== undefined && normalizedLower(body.view) !== "image-agent") {
    return janitorAiJsonResponse(req, { error: "Invalid view." }, { status: 400 });
  }

  const prompt = resolvePrompt(body);
  if (!prompt) {
    return janitorAiJsonResponse(req, { error: "Prompt required." }, { status: 400 });
  }

  const maxImages = positiveInteger(body.maxImages) ?? 1;
  const models = resolveModels(body).slice(0, Math.max(maxImages, 1));
  const images: AgentImage[] = [];
  const seedUsed = integerOrNull(body.seed);

  for (const model of models) {
    if (images.length >= maxImages) break;

    const response = await invokeExistingImagePipeline({ req, body, model, prompt });
    const payload = await response.json();
    if (!response.ok) {
      return janitorAiJsonResponse(
        req,
        {
          error: providerErrorMessage(
            payload,
            `Image generation failed for ${model}.`
          ),
        },
        { status: response.status }
      );
    }

    for (const image of extractImageUrls(payload, model)) {
      if (images.length >= maxImages) break;
      images.push({
        imageUrl: image.imageUrl,
        model: image.model || model,
        ...(seedUsed !== undefined ? { seedUsed } : {}),
        prompt,
        generationTag: `Studio Agent / ${image.model || model}`,
      });
    }
  }

  if (!images.length) {
    return janitorAiJsonResponse(
      req,
      { error: "No images were returned by the image agent." },
      { status: 502 }
    );
  }

  return janitorAiJsonResponse(req, { images });
}
