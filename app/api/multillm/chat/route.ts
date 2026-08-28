import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  readUpstreamErrorDetails,
  resolveMultiLlmChatTarget,
  resolveMultiLlmApiKey,
} from "@/lib/multillm-proxy";
import {
  buildOpenAIResponsesPayload,
  shouldUseOpenAIResponses,
} from "@/lib/openai-responses";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";

export const dynamic = "force-dynamic";

type ChatRequest = {
  apiKey?: string;
  model?: string;
  messages?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: unknown;
};

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = await readJsonRequestObject<ChatRequest>(request);
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
  if (!body.model?.trim() || !Array.isArray(body.messages)) {
    return Response.json(
      { error: "model and messages are required." },
      { status: 400 }
    );
  }

  const target = resolveMultiLlmChatTarget(body.model);
  if (!target.model) {
    return Response.json({ error: "model is required." }, { status: 400 });
  }

  const useResponses = shouldUseOpenAIResponses("multillm", body.model);
  const payload = useResponses
    ? buildOpenAIResponsesPayload({
        model: target.model,
        messages: body.messages,
        tools: body.tools,
        toolChoice: body.toolChoice,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        reasoningEffort: body.reasoningEffort,
      })
    : {
        model: target.model,
        messages: body.messages,
        stream: true,
        ...(body.tools?.length ? { tools: body.tools } : {}),
        ...(body.toolChoice !== undefined
          ? { tool_choice: body.toolChoice }
          : {}),
        ...(Number.isFinite(body.maxTokens)
          ? { max_tokens: body.maxTokens }
          : {}),
        ...(Number.isFinite(body.temperature)
          ? { temperature: body.temperature }
          : {}),
      };

  const response = await fetch(
    `${getMultiLlmProxyBaseUrl()}${
      useResponses ? target.responsesPath : target.completionPath
    }`,
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
        "MultiLLM chat completion failed.",
        [apiKey]
      ),
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
