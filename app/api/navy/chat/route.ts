export const runtime = "edge";

type ChatRequest = {
  apiKey: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
};

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, model, messages, tools, toolChoice, maxTokens, temperature } =
    body;
  if (!apiKey || !model || !Array.isArray(messages)) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };

  if (Array.isArray(tools) && tools.length) {
    payload.tools = tools;
  }
  if (toolChoice !== undefined) {
    payload.tool_choice = toolChoice;
  }
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
    payload.max_tokens = maxTokens;
  }
  if (typeof temperature === "number" && Number.isFinite(temperature)) {
    payload.temperature = temperature;
  }

  const response = await fetch("https://api.navy/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json();
    return Response.json(
      { error: data?.error?.message ?? "Chat completion failed." },
      { status: response.status }
    );
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
