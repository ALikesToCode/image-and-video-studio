export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import { buildChatCompletionPayload } from "@/lib/chat-tooling";

type ChatRequest = {
  apiKey?: string;
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

  const { model, messages, tools, toolChoice, maxTokens, temperature } =
    body;
  const apiKey = getUserApiKey(req, body);
  if (!apiKey || !model || !Array.isArray(messages)) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const payload = buildChatCompletionPayload({
    model,
    messages,
    tools,
    toolChoice,
    maxTokens,
    temperature,
    omitToolChoiceForUnsupportedModels: true,
  });

  const response = await fetch("https://api.navy/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await jsonOrNull(response);
    return Response.json(
      { error: providerErrorMessage(data, "Chat completion failed.", [apiKey]) },
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
