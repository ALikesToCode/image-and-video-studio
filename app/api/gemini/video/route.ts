import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import { sanitizeMediaUrl } from "@/lib/media-url";
import { buildGeminiVideoPayload } from "@/lib/studio-generation";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";
import {
  geminiOperationStatusUrl,
  normalizeGeminiOperationName,
  normalizeGeminiVideoModelId,
} from "@/lib/studio-validation";

type VideoRequest = {
  apiKey?: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: string;
  negativePrompt?: string;
  sourceImage?: string | null;
  lastFrameImage?: string | null;
  referenceImages?: Array<{ dataUrl: string; role?: string }>;
};

export async function POST(req: Request) {
  let body: VideoRequest;
  try {
    body = await readJsonRequestObject<VideoRequest>(req);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return Response.json({ error: details.error }, { status: details.status });
  }

  const { prompt, model, aspectRatio, resolution, durationSeconds, negativePrompt } =
    body;
  const userApiKey = getUserApiKey(req, body);
  if (!userApiKey || !prompt || !model) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const geminiModel = normalizeGeminiVideoModelId(model);
  if (!geminiModel) {
    return Response.json(
      { error: "Unsupported Gemini video model." },
      { status: 400 }
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:predictLongRunning`;
  const payload = buildGeminiVideoPayload({
    prompt,
    aspectRatio,
    resolution,
    durationSeconds,
    negativePrompt,
    sourceImage: body.sourceImage,
    lastFrameImage: body.lastFrameImage,
    referenceImages: body.referenceImages,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": userApiKey,
    },
    body: JSON.stringify(payload),
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
  if (typeof dataRecord.name !== "string") {
    return Response.json(
      { error: "No operation name returned by Veo." },
      { status: 502 }
    );
  }

  return Response.json({ name: dataRecord.name });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const apiKey = req.headers.get("x-user-api-key");

  if (!name || !apiKey) {
    return Response.json({ error: "Missing operation name or API key." }, { status: 400 });
  }

  const operationName = normalizeGeminiOperationName(name);
  if (!operationName) {
    return Response.json({ error: "Invalid operation name." }, { status: 400 });
  }

  const response = await fetch(geminiOperationStatusUrl(operationName), {
    headers: {
      "x-goog-api-key": apiKey,
    },
  });
  const data = await jsonOrNull(response);

  if (!response.ok) {
    return Response.json(
      { error: providerErrorMessage(data, "Unable to fetch operation.", [apiKey]) },
      { status: response.status }
    );
  }

  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (!dataRecord.done) {
    return Response.json({ done: false });
  }

  const error = dataRecord.error;
  if (error) {
    const errorRecord =
      error && typeof error === "object" ? (error as Record<string, unknown>) : {};
    return Response.json(
      {
        done: true,
        error: providerErrorMessage(
          { error: errorRecord },
          "Video generation failed.",
          [apiKey]
        ),
      },
      { status: 502 }
    );
  }

  const responseRecord =
    dataRecord.response && typeof dataRecord.response === "object"
      ? (dataRecord.response as Record<string, unknown>)
      : {};
  const generateVideoResponse =
    responseRecord.generateVideoResponse &&
    typeof responseRecord.generateVideoResponse === "object"
      ? (responseRecord.generateVideoResponse as Record<string, unknown>)
      : {};
  const samples = Array.isArray(generateVideoResponse.generatedSamples)
    ? generateVideoResponse.generatedSamples
    : [];
  const firstSample =
    samples[0] && typeof samples[0] === "object"
      ? (samples[0] as Record<string, unknown>)
      : {};
  const video =
    firstSample.video && typeof firstSample.video === "object"
      ? (firstSample.video as Record<string, unknown>)
      : {};
  const videoUri = sanitizeMediaUrl(video.uri, {
    kind: "video",
    allowData: false,
    allowBlob: false,
  });

  if (!videoUri) {
    return Response.json(
      { done: true, error: "Video URL not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, videoUri });
}
