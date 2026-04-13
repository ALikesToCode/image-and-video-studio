export const runtime = "edge";

import {
  buildNavyImageGenerationPayload,
  isNavyGenerationPending,
} from "@/lib/studio-generation";

type ImageRequest = {
  apiKey: string;
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
    apiKey,
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
  if (!apiKey || !model || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Image generation failed." },
      { status: response.status }
    );
  }

  if (typeof data?.id === "string" && !Array.isArray(data?.data)) {
    return Response.json({ id: data.id, status: data.status ?? null });
  }

  const images = Array.isArray(data?.data)
    ? data.data.map((item: { url?: string; b64_json?: string }) => ({
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

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Unable to fetch job." },
      { status: response.status }
    );
  }

  if (isNavyGenerationPending(typeof data?.status === "string" ? data.status : null)) {
    return Response.json({ done: false, status: data.status });
  }

  const result = data?.result ?? data;
  const images = Array.isArray(result?.data)
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
