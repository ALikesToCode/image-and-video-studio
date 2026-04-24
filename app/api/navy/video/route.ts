export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import {
  buildNavyImageGenerationPayload,
  isNavyGenerationPending,
} from "@/lib/studio-generation";

type VideoRequest = {
  apiKey?: string;
  model: string;
  prompt: string;
  imageUrl?: string;
  negativePrompt?: string;
  seconds?: number;
  aspectRatio?: string;
};

export async function POST(req: Request) {
  let body: VideoRequest;
  try {
    body = (await req.json()) as VideoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { model, prompt, imageUrl, negativePrompt, seconds, aspectRatio } =
    body;
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
        imageUrl,
        negativePrompt,
        seconds,
        aspectRatio,
        sync: false,
      })
    ),
  });

  const data = await jsonOrNull(response);
  if (!response.ok) {
    return Response.json(
      {
        error: providerErrorMessage(data, "Video generation failed.", [
          userApiKey,
        ]),
      },
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (!dataRecord.id) {
    const dataItems = Array.isArray(dataRecord.data) ? dataRecord.data : [];
    const result =
      dataRecord.result && typeof dataRecord.result === "object"
        ? (dataRecord.result as Record<string, unknown>)
        : {};
    const resultItems = Array.isArray(result.data) ? result.data : [];
    const firstData =
      dataItems[0] && typeof dataItems[0] === "object"
        ? (dataItems[0] as Record<string, unknown>)
        : {};
    const firstResult =
      resultItems[0] && typeof resultItems[0] === "object"
        ? (resultItems[0] as Record<string, unknown>)
        : {};
    const videoUrl = firstData.url ?? firstResult.url;
    if (typeof videoUrl === "string" && videoUrl) {
      return Response.json({ videoUrl, status: dataRecord.status ?? null });
    }
    return Response.json(
      { error: "No job id returned by NavyAI." },
      { status: 502 }
    );
  }

  return Response.json({ id: dataRecord.id });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const apiKey = req.headers.get("x-user-api-key");

  if (!id || !apiKey) {
    return Response.json({ error: "Missing job id or API key." }, { status: 400 });
  }

  const response = await fetch(`https://api.navy/v1/images/generations/${id}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

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
  const resultItems = Array.isArray(result.data) ? result.data : [];
  const firstResult =
    resultItems[0] && typeof resultItems[0] === "object"
      ? (resultItems[0] as Record<string, unknown>)
      : {};
  const url =
    firstResult.url ??
    firstResult.video_url ??
    result.video_url ??
    result.url;

  if (!url) {
    return Response.json(
      { done: true, error: "Video URL not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, videoUrl: url });
}
