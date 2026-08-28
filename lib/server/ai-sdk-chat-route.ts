import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createUIMessageStreamResponse,
  InvalidToolInputError,
  NoSuchToolError,
  streamText,
  toUIMessageStream,
  ToolCallRepairError,
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
} from "../chat-completion.ts";
import {
  getMultiLlmProxyBaseUrl,
  resolveMultiLlmChatTarget,
  resolveMultiLlmApiKey,
} from "../multillm-proxy.ts";
import {
  isOpenAIReasoningModel,
  shouldUseOpenAIResponses,
} from "../openai-responses.ts";
import { normalizeStudioChatOutputTokens } from "../llm-output-budget.ts";
import {
  MAX_UPSTREAM_ERROR_BYTES,
  jsonBodyErrorDetails,
  readBoundedTextBody,
  readJsonRequestObject,
} from "./json-body.ts";

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

const MAX_STUDIO_CHAT_MESSAGES = 120;
const MAX_STUDIO_CHAT_MODEL_ID_LENGTH = 200;
const MAX_STUDIO_CHAT_INSTRUCTIONS_LENGTH = 64_000;

const isStudioChatProvider = (value: unknown): value is StudioChatProvider =>
  value === "navy" ||
  value === "chutes" ||
  value === "nanogpt" ||
  value === "multillm";

const isRecoverableChatStatus = (status: number) =>
  status === 400 || status === 422;

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
    const text = await readBoundedTextBody(
      response.clone(),
      MAX_UPSTREAM_ERROR_BYTES,
    );
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

const safeStreamError = (error: unknown, apiKey: string) => {
  if (InvalidToolInputError.isInstance(error)) {
    return "The model called a tool with invalid inputs.";
  }
  if (NoSuchToolError.isInstance(error)) {
    return "The model called an unavailable tool.";
  }
  if (ToolCallRepairError.isInstance(error)) {
    return "The model produced an invalid tool call.";
  }
  if (typeof error === "string") {
    return "Chat completion failed.";
  }
  return providerErrorMessage(error, "Chat completion failed.", [apiKey]).slice(
    0,
    1000
  );
};

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

const finishMessageMetadata = ({
  finishReason,
  usage,
}: {
  finishReason: string;
  usage: Parameters<typeof usageMessageMetadata>[0];
}) => ({
  finishReason,
  ...usageMessageMetadata(usage),
});

export async function handleAIStudioChatRequest(request: Request) {
  let body: StudioChatRequest;
  try {
    body = await readJsonRequestObject<StudioChatRequest>(request);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return Response.json(
      { error: details.error },
      { status: details.status },
    );
  }

  if (!isStudioChatProvider(body.provider)) {
    return Response.json(
      { error: "Unsupported chat provider." },
      { status: 400 }
    );
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (model.length > MAX_STUDIO_CHAT_MODEL_ID_LENGTH) {
    return Response.json({ error: "Invalid chat model." }, { status: 400 });
  }
  if (
    !Array.isArray(body.messages) ||
    body.messages.length === 0 ||
    body.messages.length > MAX_STUDIO_CHAT_MESSAGES
  ) {
    return Response.json(
      { error: `Chat requires 1-${MAX_STUDIO_CHAT_MESSAGES} messages.` },
      { status: 400 },
    );
  }
  const modelMessages = toAIModelMessages(body.messages);
  const instructions = modelMessages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  if (instructions.length > MAX_STUDIO_CHAT_INSTRUCTIONS_LENGTH) {
    return Response.json(
      {
        error: `System instructions must contain at most ${MAX_STUDIO_CHAT_INSTRUCTIONS_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }
  const messages = modelMessages.filter((message) => message.role !== "system");
  const apiKey =
    body.provider === "multillm"
      ? resolveMultiLlmApiKey(request, body.apiKey)
      : getUserApiKey(request, body as unknown as Record<string, unknown>);
  if (!apiKey || !model || !messages.length) {
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
  const multiLlmTarget =
    providerId === "multillm" ? resolveMultiLlmChatTarget(model) : undefined;
  const upstreamModel = multiLlmTarget?.model ?? model;
  const baseURL =
    providerId === "multillm"
      ? `${getMultiLlmProxyBaseUrl()}${multiLlmTarget?.basePath ?? "/v1"}`
      : PROVIDER_BASE_URLS[providerId];
  const useOpenAIResponses = shouldUseOpenAIResponses(providerId, model);

  try {
    const languageModel = useOpenAIResponses
      ? createOpenAI({
          name: providerId,
          apiKey,
          baseURL,
        }).responses(upstreamModel)
      : createOpenAICompatible({
          name: providerId,
          apiKey,
          baseURL,
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
              model: upstreamModel,
              body: providerBody,
              thinking: body.thinking,
              reasoningEffort: body.reasoningEffort,
            }),
        }).chatModel(upstreamModel);
    const result = streamText({
      model: languageModel,
      ...(instructions ? { instructions } : {}),
      messages,
      tools,
      toolChoice,
      maxOutputTokens: normalizeStudioChatOutputTokens(body.maxTokens),
      reasoning,
      ...(useOpenAIResponses
        ? {
            providerOptions: {
              openai: {
                store: false,
                forceReasoning: isOpenAIReasoningModel(model),
                ...(reasoning !== undefined
                  ? { reasoningEffort: reasoning }
                  : {}),
              },
            },
          }
        : {}),
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
          ? finishMessageMetadata({
              finishReason: part.finishReason,
              usage: part.totalUsage,
            })
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
