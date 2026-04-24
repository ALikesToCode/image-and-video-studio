export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
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

type NavyImagePayload = {
  data: string;
  mimeType: string;
};

const NAVY_IMAGE_MEDIA_HOSTS = [
  "api.navy",
  ".api.navy",
  "replicate.delivery",
  ".replicate.delivery",
];

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const contentTypeFromRecord = (record: Record<string, unknown>) =>
  typeof record.mimeType === "string"
    ? record.mimeType
    : typeof record.mime_type === "string"
      ? record.mime_type
      : "image/png";

const downloadGeneratedImage = async (url: string): Promise<NavyImagePayload> => {
  const response = await safeFetchExternalMedia(url, {
    allowedHosts: NAVY_IMAGE_MEDIA_HOSTS,
    allowedContentTypes: ["image/"],
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: 30_000,
    allowRedirects: true,
  });
  const contentType = response.headers.get("content-type") ?? "image/png";
  return {
    data: arrayBufferToBase64(await response.arrayBuffer()),
    mimeType: contentType.split(";")[0] ?? "image/png",
  };
};

const normalizeNavyImages = async (items: unknown[]) => {
  const images: NavyImagePayload[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.b64_json === "string" && record.b64_json) {
      images.push({
        data: record.b64_json,
        mimeType: contentTypeFromRecord(record),
      });
      continue;
    }
    if (typeof record.data === "string" && record.data) {
      images.push({
        data: record.data,
        mimeType: contentTypeFromRecord(record),
      });
      continue;
    }
    if (typeof record.url === "string" && record.url) {
      images.push(await downloadGeneratedImage(record.url));
    }
  }
  return images;
};

const imageDownloadError = () =>
  Response.json(
    { error: "Unable to download generated image." },
    { status: 502 }
  );

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

  let images: NavyImagePayload[];
  try {
    images = Array.isArray(dataRecord.data)
      ? await normalizeNavyImages(dataRecord.data)
      : [];
  } catch {
    return imageDownloadError();
  }

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
  let images: NavyImagePayload[];
  try {
    images = Array.isArray(result.data)
      ? await normalizeNavyImages(result.data)
      : [];
  } catch {
    return imageDownloadError();
  }

  if (!images.length) {
    return Response.json(
      { done: true, error: "Image result not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, images });
}
