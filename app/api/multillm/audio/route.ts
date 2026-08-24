import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  parseMediaModelId,
  readUpstreamError,
  resolveMultiLlmApiKey,
  type MultiLlmMediaSource,
} from "@/lib/multillm-proxy";

export const dynamic = "force-dynamic";

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
    body = (await request.json()) as AudioRequest;
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
      {
        error: await readUpstreamError(
          response,
          "MultiLLM audio generation failed.",
          [apiKey]
        ),
      },
      { status: response.status }
    );
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    response.headers.get("content-type") ?? "audio/mpeg"
  );
  const disposition = response.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  headers.set("Cache-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
