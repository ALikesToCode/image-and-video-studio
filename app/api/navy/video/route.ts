export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorDetails } from "@/lib/api-safety";
import {
  buildNavyImageGenerationPayload,
  isNavyGenerationFailed,
  isNavyGenerationPending,
} from "@/lib/studio-generation";
import { normalizeNavyJobId } from "@/lib/studio-validation";

type VideoRequest = {
  apiKey?: string;
  model: string;
  prompt: string;
  imageUrl?: string | string[];
  imageUrls?: string[];
  image_url?: string | string[];
  size?: string;
  negativePrompt?: string;
  seed?: number | null;
  seconds?: number;
  aspectRatio?: string;
  responseFormat?: string;
};

const retryAfterMs = (response: Response, fallbackMs = 8_000) => {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1_000, Math.ceil(seconds * 1000));
  }
  const timestamp = Date.parse(retryAfter);
  if (Number.isFinite(timestamp)) {
    return Math.max(1_000, timestamp - Date.now());
  }
  return fallbackMs;
};

export async function POST(req: Request) {
  let body: VideoRequest;
  try {
    body = (await req.json()) as VideoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { model, prompt, size, negativePrompt, seed, seconds, aspectRatio, responseFormat } =
    body;
  const imageUrl = body.imageUrl ?? body.imageUrls ?? body.image_url;
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
        imageUrl,
        negativePrompt,
        seed,
        seconds,
        aspectRatio,
        responseFormat,
        sync: false,
      })
    ),
  });

  const data = await jsonOrNull(response);
  if (!response.ok) {
    return Response.json(
      providerErrorDetails(data, "Video generation failed.", {
        knownSecrets: [userApiKey],
        response,
      }),
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isNavyGenerationFailed(dataRecord.status)) {
    return Response.json(
      providerErrorDetails(data, "Video generation job failed.", {
        knownSecrets: [userApiKey],
        response,
      }),
      { status: 502 }
    );
  }
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
  const jobId = normalizeNavyJobId(id);
  if (!jobId) {
    return Response.json({ error: "Invalid job id." }, { status: 400 });
  }

  const response = await fetch(
    `https://api.navy/v1/images/generations/${encodeURIComponent(jobId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  const data = await jsonOrNull(response);
  if (response.status === 429) {
    const delayMs = retryAfterMs(response);
    return Response.json(
      { done: false, status: "rate_limited", retryAfterMs: delayMs },
      {
        status: 200,
        headers: { "Retry-After": String(Math.ceil(delayMs / 1000)) },
      }
    );
  }

  if (!response.ok) {
    return Response.json(
      providerErrorDetails(data, "Unable to fetch job.", {
        knownSecrets: [apiKey],
        response,
      }),
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (isNavyGenerationFailed(dataRecord.status)) {
    return Response.json(
      providerErrorDetails(data, "Video generation job failed.", {
        knownSecrets: [apiKey],
        response,
      }),
      { status: 502 }
    );
  }
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
