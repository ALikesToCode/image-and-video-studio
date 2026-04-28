export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import {
  buildChatCompletionPayload,
  buildChatCompletionRecoveryPayloads,
} from "@/lib/chat-tooling";

type ChatRequest = {
  apiKey?: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  thinking?: { type?: unknown };
  reasoningEffort?: unknown;
};

const isRecoverableChatStatus = (status: number) => status === 400 || status === 422;

const upstreamChatCompletion = (
  apiKey: string,
  payload: Record<string, unknown>
) =>
  fetch("https://api.navy/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

const streamingResponse = (response: Response, recoveryLabel?: string) =>
  new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(recoveryLabel ? { "x-studio-chat-recovery": recoveryLabel } : {}),
    },
  });

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const {
    model,
    messages,
    tools,
    toolChoice,
    maxTokens,
    temperature,
    thinking,
    reasoningEffort,
  } = body;
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
    thinking,
    reasoningEffort,
    omitToolChoiceForUnsupportedModels: true,
  });

  const response = await upstreamChatCompletion(apiKey, payload);

  if (!response.ok) {
    let data = await jsonOrNull(response);
    if (isRecoverableChatStatus(response.status)) {
      for (const recovery of buildChatCompletionRecoveryPayloads(payload)) {
        const retryResponse = await upstreamChatCompletion(apiKey, recovery.payload);
        if (retryResponse.ok) {
          return streamingResponse(retryResponse, recovery.label);
        }
        data = await jsonOrNull(retryResponse);
        if (!isRecoverableChatStatus(retryResponse.status)) {
          return Response.json(
            {
              error: providerErrorMessage(data, "Chat completion failed.", [
                apiKey,
              ]),
            },
            { status: retryResponse.status }
          );
        }
      }
    }
    return Response.json(
      { error: providerErrorMessage(data, "Chat completion failed.", [apiKey]) },
      { status: response.status }
    );
  }

  return streamingResponse(response);
}
