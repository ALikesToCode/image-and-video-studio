import {
  extractJobId,
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  parseMediaModelId,
  parseVideoJobPayload,
  readUpstreamError,
  resolveMultiLlmApiKey,
  type MultiLlmMediaSource,
} from "@/lib/multillm-proxy";

export const dynamic = "force-dynamic";

type VideoRequest = {
  apiKey?: string;
  model?: string;
  prompt?: string;
  aspectRatio?: string;
  resolution?: string;
  seconds?: number;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  sourceImage?: string;
  referenceImages?: string[];
  negativePrompt?: string;
  parameters?: Record<string, unknown>;
};

export async function POST(request: Request) {
  let body: VideoRequest;
  try {
    body = (await request.json()) as VideoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const apiKey = resolveMultiLlmApiKey(request, body.apiKey);
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Missing MultiLLM API key. Add it in Settings or set MULTILLM_API_KEY on the server.",
      },
      { status: 400 }
    );
  }
  if (!body.prompt?.trim()) {
    return Response.json({ error: "prompt is required." }, { status: 400 });
  }

  let source: MultiLlmMediaSource;
  let model: string;
  try {
    ({ source, model } = parseMediaModelId(body.model));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid model." },
      { status: 400 }
    );
  }
  if (source === "linkapi") {
    return Response.json(
      {
        error:
          "MultiLLM video models must use the navyai: or nanogpt: source prefix.",
      },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    ...(body.parameters &&
    typeof body.parameters === "object" &&
    !Array.isArray(body.parameters)
      ? body.parameters
      : {}),
    model,
    prompt: body.prompt.trim(),
  };
  if (body.aspectRatio) payload.aspect_ratio = body.aspectRatio;
  if (body.negativePrompt) payload.negative_prompt = body.negativePrompt;

  let path: string;
  const imageInputs = [
    ...(body.sourceImage ? [body.sourceImage] : []),
    ...(body.imageDataUrl ? [body.imageDataUrl] : []),
    ...(Array.isArray(body.imageDataUrls) ? body.imageDataUrls : []),
    ...(Array.isArray(body.referenceImages) ? body.referenceImages : []),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  if (source === "navyai") {
    path = "/navyai/v1/images/generations";
    payload.sync = false;
    if (Number.isFinite(body.seconds)) payload.seconds = body.seconds;
    if (imageInputs.length) {
      payload.image_url =
        imageInputs.length === 1 ? imageInputs[0] : imageInputs;
    }
  } else {
    path = "/nanogpt/generate-video";
    if (Number.isFinite(body.seconds)) {
      payload.duration = String(body.seconds);
    }
    if (body.resolution) payload.resolution = body.resolution;
    if (imageInputs[0]) payload.imageDataUrl = imageInputs[0];
    if (imageInputs.length > 1) {
      payload.referenceImages = imageInputs.slice(1);
    }
  }

  const response = await fetch(`${getMultiLlmProxyBaseUrl()}${path}`, {
    method: "POST",
    headers: multiLlmAuthorizationHeaders(apiKey, "application/json"),
    body: JSON.stringify(payload),
    signal: request.signal,
  });
  if (!response.ok) {
    return Response.json(
      {
        error: await readUpstreamError(
          response,
          "MultiLLM video generation failed.",
          [apiKey]
        ),
      },
      { status: response.status }
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("video/")) {
    return new Response(response.body, {
      headers: { "Content-Type": contentType },
    });
  }

  const responsePayload = (await response.json()) as unknown;
  const parsed = parseVideoJobPayload(responsePayload);
  if (parsed.videoUrl) {
    return Response.json(parsed);
  }

  const id = extractJobId(responsePayload);
  if (!id) {
    return Response.json(
      {
        error:
          parsed.error ?? "The provider returned neither a video nor a job ID.",
      },
      { status: 502 }
    );
  }

  return Response.json(
    { id, source, model, status: parsed.status },
    { status: 202 }
  );
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const source = url.searchParams.get("source");
  const apiKey = resolveMultiLlmApiKey(request);
  if (
    !apiKey ||
    !id ||
    (source !== "navyai" && source !== "nanogpt")
  ) {
    return Response.json(
      { error: "A valid job id, source, and MultiLLM API key are required." },
      { status: 400 }
    );
  }

  const upstreamUrl =
    source === "navyai"
      ? `${getMultiLlmProxyBaseUrl()}/navyai/v1/images/generations/${encodeURIComponent(
          id
        )}`
      : `${getMultiLlmProxyBaseUrl()}/nanogpt/video/status?requestId=${encodeURIComponent(
          id
        )}`;
  const response = await fetch(upstreamUrl, {
    headers: multiLlmAuthorizationHeaders(apiKey),
    cache: "no-store",
    signal: request.signal,
  });
  if (!response.ok) {
    return Response.json(
      {
        error: await readUpstreamError(
          response,
          "Unable to fetch the video job.",
          [apiKey]
        ),
      },
      { status: response.status }
    );
  }

  const payload = (await response.json()) as unknown;
  const parsed = parseVideoJobPayload(payload);
  return Response.json(parsed);
}
