export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import {
  buildNavyImageGenerationPayload,
  isNavyGenerationPending,
} from "@/lib/studio-generation";

type ImageRequest = {
  apiKey?: string;
  model: string;
  prompt: string;
  size?: string;
  numberOfImages?: number;
  quality?: string;
  style?: string;
  imageUrl?: string;
  negativePrompt?: string;
  seed?: number | null;
  seconds?: number;
  sync?: boolean;
  responseFormat?: string;
  aspectRatio?: string;
};

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const {
    model,
    prompt,
    size,
    numberOfImages,
    quality,
    style,
    imageUrl,
    negativePrompt,
    seed,
    seconds,
    sync,
    responseFormat,
    aspectRatio,
  } = body;
  const userApiKey = getUserApiKey(req, body);
  if (!userApiKey || !model || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userApiKey}`,
    },
    body: JSON.stringify(
      buildNavyImageGenerationPayload({
        model,
        prompt,
        size,
        numberOfImages,
        quality,
        style,
        imageUrl,
        negativePrompt,
        seed,
        seconds,
        sync,
        responseFormat,
        aspectRatio,
      })
    ),
  });

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
  if (typeof dataRecord.id === "string" && !Array.isArray(dataRecord.data)) {
    return Response.json({ id: dataRecord.id, status: dataRecord.status ?? null });
  }

  const images = Array.isArray(dataRecord.data)
    ? dataRecord.data.map((item: { url?: string; b64_json?: string }) => ({
        url: item.url,
        b64_json: item.b64_json,
      }))
    : [];

  if (!images?.length) {
    return Response.json(
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const apiKey = req.headers.get("x-user-api-key");

  if (!id || !apiKey) {
    return Response.json({ error: "Missing job id or API key." }, { status: 400 });
  }

  const response = await fetch(`https://api.navy/v1/images/generations/${id}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await jsonOrNull(response);
  if (!response.ok) {
    return Response.json(
      { error: providerErrorMessage(data, "Unable to fetch job.", [apiKey]) },
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isNavyGenerationPending(typeof dataRecord.status === "string" ? dataRecord.status : null)) {
    return Response.json({ done: false, status: dataRecord.status });
  }

  const result =
    dataRecord.result && typeof dataRecord.result === "object"
      ? (dataRecord.result as Record<string, unknown>)
      : dataRecord;
  const images = Array.isArray(result.data)
    ? result.data.map((item: { url?: string; b64_json?: string }) => ({
        url: item.url,
        b64_json: item.b64_json,
      }))
    : [];

  if (!images.length) {
    return Response.json(
      { done: true, error: "Image result not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, images });
}
