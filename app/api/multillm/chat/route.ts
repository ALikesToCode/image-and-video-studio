import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  readUpstreamError,
  resolveMultiLlmApiKey,
} from "@/lib/multillm-proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type ChatRequest = {
  apiKey?: string;
  model?: string;
  messages?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
};

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
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
  if (!body.model?.trim() || !Array.isArray(body.messages)) {
    return Response.json(
      { error: "model and messages are required." },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    model: body.model.trim(),
    messages: body.messages,
    stream: true,
  };
  if (body.tools?.length) payload.tools = body.tools;
  if (body.toolChoice !== undefined) payload.tool_choice = body.toolChoice;
  if (Number.isFinite(body.maxTokens)) payload.max_tokens = body.maxTokens;
  if (Number.isFinite(body.temperature)) {
    payload.temperature = body.temperature;
  }

  const response = await fetch(
    `${getMultiLlmProxyBaseUrl()}/v1/chat/completions`,
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
          "MultiLLM chat completion failed.",
          [apiKey]
        ),
      },
      { status: response.status }
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
