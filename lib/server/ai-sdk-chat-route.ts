import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";

import { getUserApiKey, providerErrorMessage } from "../api-safety.ts";
import {
  buildAIChatTools,
  normalizeAIChatRequestBody,
  normalizeAIChatToolChoice,
  normalizeEnabledAIChatTools,
  repairAIChatToolCall,
  toAIModelMessages,
} from "../ai-sdk-chat.ts";
import {
  buildChatCompletionRecoveryPayloads,
  isDeepSeekV4Model,
  normalizeReasoningEffort,
} from "../chat-tooling.ts";
import {
  getMultiLlmProxyBaseUrl,
  resolveMultiLlmApiKey,
} from "../multillm-proxy.ts";

type StudioChatProvider = "navy" | "chutes" | "nanogpt" | "multillm";

type StudioChatRequest = {
  apiKey?: string;
  provider?: unknown;
  model?: unknown;
  messages?: unknown;
  enabledTools?: unknown;
  toolChoice?: unknown;
  maxTokens?: unknown;
  temperature?: unknown;
  thinking?: { type?: unknown };
  reasoningEffort?: unknown;
};

const PROVIDER_BASE_URLS: Record<StudioChatProvider, string> = {
  navy: "https://api.navy/v1",
  chutes: "https://llm.chutes.ai/v1",
  nanogpt: "https://nano-gpt.com/api/v1",
  multillm: "",
};

const NATIVE_IMAGE_URLS = {
  "image/*": [/^https?:\/\//],
};

const isStudioChatProvider = (value: unknown): value is StudioChatProvider =>
  value === "navy" ||
  value === "chutes" ||
  value === "nanogpt" ||
  value === "multillm";

const isRecoverableChatStatus = (status: number) =>
  status === 400 || status === 422;

const parseRequestBody = async (request: Request) => {
  try {
    return (await request.json()) as StudioChatRequest;
  } catch {
    return null;
  }
};

const requestJSONBody = (init?: RequestInit) => {
  if (typeof init?.body !== "string") return null;
  try {
    const parsed = JSON.parse(init.body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const responseErrorBody = async (response: Response) => {
  try {
    const text = await response.clone().text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
};

const createRecoveringChatFetch = (allowGeneralRecoveries: boolean) =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    let response = await globalThis.fetch(input, init);
    if (!isRecoverableChatStatus(response.status)) return response;

    const payload = requestJSONBody(init);
    if (!payload) return response;
    const providerError = await responseErrorBody(response);
    const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
    const recoveries = buildChatCompletionRecoveryPayloads(payload, {
      providerError,
    }).filter(
      ({ label }) =>
        (allowGeneralRecoveries || label === "disable-reasoning-for-tools") &&
        !(hasTools && label === "text-only")
    );

    for (const recovery of recoveries) {
      await response.body?.cancel().catch(() => undefined);
      response = await globalThis.fetch(input, {
        ...init,
        body: JSON.stringify(recovery.payload),
      });
      if (response.ok || !isRecoverableChatStatus(response.status)) {
        return response;
      }
    }
    return response;
  };

const recoveringNavyFetch = createRecoveringChatFetch(true);
const recoveringNanoGptFetch = createRecoveringChatFetch(false);
const recoveringMultiLlmFetch = createRecoveringChatFetch(true);

const maxOutputTokens = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1024;
  return Math.min(8192, Math.max(1, Math.trunc(value)));
};

const safeStreamError = (error: unknown, apiKey: string) =>
  providerErrorMessage(error, "Chat completion failed.", [apiKey]).slice(
    0,
    1000
  );

const usageMessageMetadata = (usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}) => {
  const entries = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
  };
  const defined = Object.fromEntries(
    Object.entries(entries).filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value),
    ),
  );
  return Object.keys(defined).length ? { usage: defined } : undefined;
};

export async function handleAIStudioChatRequest(request: Request) {
  const body = await parseRequestBody(request);
  if (!body) {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!isStudioChatProvider(body.provider)) {
    return Response.json(
      { error: "Unsupported chat provider." },
      { status: 400 }
    );
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  const modelMessages = toAIModelMessages(body.messages);
  const instructions = modelMessages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages = modelMessages.filter((message) => message.role !== "system");
  const apiKey =
    body.provider === "multillm"
      ? resolveMultiLlmApiKey(request, body.apiKey)
      : getUserApiKey(request, body as unknown as Record<string, unknown>);
  if (!apiKey || !model || !Array.isArray(body.messages) || !messages.length) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const providerId = body.provider;
  const enabledTools = normalizeEnabledAIChatTools(body.enabledTools);
  const tools = buildAIChatTools(enabledTools);
  const toolChoice = normalizeAIChatToolChoice(body.toolChoice, enabledTools);
  const reasoning =
    body.reasoningEffort === undefined || isDeepSeekV4Model(model)
      ? undefined
      : normalizeReasoningEffort(body.reasoningEffort);

  try {
    const provider = createOpenAICompatible({
      name: providerId,
      apiKey,
      baseURL:
        providerId === "multillm"
          ? `${getMultiLlmProxyBaseUrl()}/v1`
          : PROVIDER_BASE_URLS[providerId],
      includeUsage:
        providerId === "navy" ||
        providerId === "nanogpt" ||
        providerId === "multillm",
      fetch:
        providerId === "navy"
          ? recoveringNavyFetch
          : providerId === "nanogpt"
            ? recoveringNanoGptFetch
            : providerId === "multillm"
              ? recoveringMultiLlmFetch
              : undefined,
      supportedUrls: () => NATIVE_IMAGE_URLS,
      transformRequestBody: (providerBody) =>
        normalizeAIChatRequestBody({
          model,
          body: providerBody,
          thinking: body.thinking,
          reasoningEffort: body.reasoningEffort,
        }),
    });
    const result = streamText({
      model: provider.chatModel(model),
      ...(instructions ? { instructions } : {}),
      messages,
      tools,
      toolChoice,
      maxOutputTokens: maxOutputTokens(body.maxTokens),
      reasoning,
      experimental_repairToolCall: repairAIChatToolCall,
      abortSignal: request.signal,
      onError: () => undefined,
    });
    const stream = toUIMessageStream({
      stream: result.stream,
      tools,
      sendReasoning: true,
      messageMetadata: ({ part }) =>
        part.type === "finish"
          ? usageMessageMetadata(part.totalUsage)
          : undefined,
      onError: (error) => safeStreamError(error, apiKey),
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return Response.json(
      { error: safeStreamError(error, apiKey) },
      { status: 502 }
    );
  }
}
