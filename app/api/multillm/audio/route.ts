import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  parseMediaModelId,
  readUpstreamErrorDetails,
  resolveMultiLlmApiKey,
  type MultiLlmMediaSource,
} from "@/lib/multillm-proxy";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";
import { proxyBoundedMediaResponse } from "@/lib/server/media-response";
import { AUDIO_MIME_TYPES } from "@/lib/studio-validation";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

type AudioRequest = {
  apiKey?: string;
  model?: string;
  input?: string;
  voice?: string;
  speed?: number;
  responseFormat?: string;
};

export async function POST(request: Request) {
  let body: AudioRequest;
  try {
    body = await readJsonRequestObject<AudioRequest>(request);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return Response.json({ error: details.error }, { status: details.status });
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
  if (!body.input?.trim()) {
    return Response.json({ error: "input is required." }, { status: 400 });
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
  if (source !== "navyai") {
    return Response.json(
      { error: "MultiLLM audio models must use the navyai: source prefix." },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    model,
    input: body.input.trim(),
    voice: body.voice?.trim() || "alloy",
  };
  if (Number.isFinite(body.speed)) payload.speed = body.speed;
  if (body.responseFormat) payload.response_format = body.responseFormat;

  const response = await fetch(
    `${getMultiLlmProxyBaseUrl()}/${source}/v1/audio/speech`,
    {
      method: "POST",
      headers: multiLlmAuthorizationHeaders(apiKey, "application/json"),
      body: JSON.stringify(payload),
      signal: request.signal,
    }
  );
  if (!response.ok) {
    return Response.json(
      await readUpstreamErrorDetails(
        response,
        "MultiLLM audio generation failed.",
        [apiKey]
      ),
      { status: response.status }
    );
  }

  try {
    return proxyBoundedMediaResponse(response, {
      allowedContentTypes: AUDIO_MIME_TYPES,
      maxBytes: MAX_AUDIO_BYTES,
    });
  } catch {
    return Response.json(
      { error: "MultiLLM returned invalid audio data." },
      { status: 502 }
    );
  }
}
