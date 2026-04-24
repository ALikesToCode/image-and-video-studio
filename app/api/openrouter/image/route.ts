export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
import { buildOpenRouterImagePayload } from "@/lib/studio-generation";

type ImageRequest = {
  apiKey?: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  outputModalities?: string[];
  referenceImages?: Array<{ dataUrl: string; role?: string }>;
};

type ImagePayload = {
  data: string;
  mimeType: string;
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

const fetchImageAsBase64 = async (url: string) => {
  const response = await safeFetchExternalMedia(url, {
    allowedHosts: ["openrouter.ai", ".openrouter.ai"],
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

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { model, prompt, aspectRatio, imageSize, outputModalities } = body;
  const userApiKey = getUserApiKey(req, body);
  if (!userApiKey || !model || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const payload = buildOpenRouterImagePayload({
    model,
    prompt,
    aspectRatio,
    imageSize,
    outputModalities,
    referenceImages: body.referenceImages,
  });

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userApiKey}`,
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await jsonOrNull(response);
  if (!response.ok) {
    return Response.json(
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
  const choices = Array.isArray(dataRecord.choices) ? dataRecord.choices : [];
  const firstChoice =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : {};
  const message =
    firstChoice.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : {};
  const images = message?.images ?? [];
  if (!Array.isArray(images) || images.length === 0) {
    return Response.json(
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  const payloadImages: ImagePayload[] = [];
  for (const image of images) {
    const url = image?.image_url?.url ?? image?.imageUrl?.url;
    if (typeof url !== "string") {
      continue;
    }
    const dataUrl = parseDataUrl(url);
    if (dataUrl) {
      payloadImages.push({ data: dataUrl.data, mimeType: dataUrl.mimeType });
      continue;
    }
    payloadImages.push(await fetchImageAsBase64(url));
  }

  if (!payloadImages.length) {
    return Response.json(
      { error: "No valid images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images: payloadImages });
}
