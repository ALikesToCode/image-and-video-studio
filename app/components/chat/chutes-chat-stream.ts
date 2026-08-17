import {
  DefaultChatTransport,
  readUIMessageStream,
} from "ai";

import type { ChatProvider } from "@/lib/constants";
import {
  extractAIChatStreamState,
  type AIChatToolName,
} from "@/lib/ai-sdk-chat";
import { toChatCompletionMessages } from "@/lib/chat-tooling";
import { readAssistantTextResponse } from "@/lib/client/chat-stream-text";
import {
  areImagePromptsEquivalent,
  buildImagePolicyRecoveryPrompt,
  buildImagePromptHelpRequest,
  buildImageRetryFallbackPrompt,
  resolveImagePromptHelpChatModels,
  resolveImagePromptRecoveryChatModels,
  type ImagePromptHelpModel,
} from "@/lib/studio-generation";
import { isDeepSeekV4Model } from "@/lib/chat-tooling";

import {
  createChatId,
  isAbortLikeError,
} from "./chutes-chat-runtime";
import type {
  ChatMessage,
  ReasoningEffort,
  ToolCall,
} from "./chutes-chat-types";

type ChatStreamClientOptions = {
  apiKey: string;
  provider: ChatProvider;
  model: string;
  systemPrompt: string;
  enabledTools: AIChatToolName[];
  reasoningEffort: ReasoningEffort;
  supportsReasoning: boolean;
  isDeepSeekV4Model: boolean;
};

type StreamOptions = {
  allowTools?: boolean;
  activeTools?: AIChatToolName[] | null;
  signal?: AbortSignal;
};

type PromptRecoveryOptions = {
  targetModel: string;
  currentPrompt: string;
  errorMessage: string;
  nextAttempt: number;
  maxAttempts: number;
  signal?: AbortSignal;
};

type PromptHelpOptions = {
  targetModel: string;
  currentPrompt: string;
  requestedHelpModel: ImagePromptHelpModel;
  signal?: AbortSignal;
};

const normalizeRecoveredImagePrompt = (value: string) => {
  const trimmed = value
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(
      /^(?:final\s+)?(?:rewritten\s+)?(?:image\s+)?prompt\s*:\s*/i,
      "",
    )
    .trim();
  if (trimmed.length < 12) return "";
  if (/\b(?:i can(?:not|'t)|sorry|unable to)\b/i.test(trimmed)) {
    return "";
  }
  return trimmed;
};

export const createChatStreamClient = ({
  apiKey,
  provider,
  model,
  systemPrompt,
  enabledTools,
  reasoningEffort,
  supportsReasoning,
  isDeepSeekV4Model: deepSeekV4,
}: ChatStreamClientOptions) => {
  const callChatStreaming = async (
    items: ChatMessage[],
    onUpdate: (update: {
      content?: string;
      thinking?: string;
      toolCalls?: ToolCall[];
    }) => void,
    toolChoiceOverride?: unknown,
    options: StreamOptions = {},
  ) => {
    const requestTools =
      options.allowTools === false
        ? []
        : options.activeTools
          ? enabledTools.filter((name) =>
              options.activeTools?.includes(name),
            )
          : enabledTools;
    const reasoningPayload =
      (provider === "navy" ||
        provider === "nanogpt" ||
        provider === "multillm") &&
      supportsReasoning
        ? {
            ...(deepSeekV4
              ? {
                  thinking: {
                    type:
                      reasoningEffort === "none"
                        ? "disabled"
                        : "enabled",
                  },
                }
              : {}),
            reasoningEffort,
          }
        : {};
    const transport = new DefaultChatTransport({
      api: "/api/studio/chat",
      headers: {
        "x-user-api-key": apiKey,
      },
      prepareSendMessagesRequest: () => ({
        body: {
          provider,
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...toChatCompletionMessages(
              items.filter((item) => !item.transient),
              {
                includeReasoningContent:
                  provider === "navy" ||
                  provider === "nanogpt" ||
                  provider === "multillm",
              },
            ),
          ],
          enabledTools: requestTools,
          ...(requestTools.length
            ? { toolChoice: toolChoiceOverride ?? "auto" }
            : {}),
          maxTokens: 1024,
          ...reasoningPayload,
        },
      }),
    });
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: `studio-${provider}`,
      messageId: undefined,
      messages: [],
      abortSignal: options.signal,
    });

    let finalState = {
      content: "",
      thinking: "",
      toolCalls: [] as ToolCall[],
      toolErrors: [] as string[],
    };
    for await (const uiMessage of readUIMessageStream({
      stream,
      terminateOnError: true,
    })) {
      finalState = extractAIChatStreamState(uiMessage);
      onUpdate({
        content: finalState.content,
        thinking: finalState.thinking,
        toolCalls: finalState.toolCalls,
      });
    }

    if (finalState.toolErrors.length) {
      throw new Error(finalState.toolErrors.join(" "));
    }
    return {
      content: finalState.content,
      thinking: finalState.thinking,
      toolCalls: finalState.toolCalls,
    };
  };

  const recoverImagePromptAfterPolicyFailure = async ({
    targetModel,
    currentPrompt,
    errorMessage,
    nextAttempt,
    maxAttempts,
    signal,
  }: PromptRecoveryOptions) => {
    const fallbackPrompt = buildImageRetryFallbackPrompt({
      model: targetModel,
      prompt: currentPrompt,
      nextAttempt,
      maxAttempts,
    });
    const recoveryInstruction = buildImagePolicyRecoveryPrompt({
      model: targetModel,
      prompt: currentPrompt,
      errorMessage,
      nextAttempt,
      maxAttempts,
    });

    if (provider === "nanogpt") {
      try {
        const recovered = await callChatStreaming(
          [
            {
              id: createChatId(),
              role: "user",
              content: recoveryInstruction,
            },
          ],
          () => undefined,
          undefined,
          { allowTools: false, signal },
        );
        const recoveredPrompt = normalizeRecoveredImagePrompt(
          recovered.content,
        );
        if (
          recoveredPrompt &&
          !areImagePromptsEquivalent(recoveredPrompt, currentPrompt)
        ) {
          return recoveredPrompt;
        }
      } catch (error) {
        if (isAbortLikeError(error, signal)) throw error;
      }
      return fallbackPrompt;
    }

    const endpoint =
      provider === "navy"
        ? "/api/navy/chat"
        : "/api/chutes/chat";
    const recoveryModels =
      resolveImagePromptRecoveryChatModels({
        provider,
        activeModel: model,
        nextAttempt,
      });

    for (const recoveryModel of recoveryModels) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-api-key": apiKey,
          },
          body: JSON.stringify({
            model: recoveryModel,
            messages: [
              {
                role: "system",
                content:
                  "You rewrite image-generation prompts after provider moderation rejections. Return only one direct image prompt. Preserve the named primary subject, semantic age band, artistic medium, composition, mood, lighting, camera/framing, and quality level while removing unsafe details. Lead with the primary subject and keep background detail subordinate.",
              },
              {
                role: "user",
                content: recoveryInstruction,
              },
            ],
            toolChoice: "none",
            maxTokens: 2200,
            ...(provider === "navy" &&
            isDeepSeekV4Model(recoveryModel)
              ? { thinking: { type: "disabled" } }
              : {}),
          }),
          signal,
        });
        if (!response.ok) continue;
        const recoveredPrompt = normalizeRecoveredImagePrompt(
          await readAssistantTextResponse(response),
        );
        if (
          recoveredPrompt &&
          !areImagePromptsEquivalent(recoveredPrompt, currentPrompt)
        ) {
          return recoveredPrompt;
        }
      } catch (error) {
        if (isAbortLikeError(error, signal)) throw error;
      }
    }

    return fallbackPrompt;
  };

  const requestImagePromptHelp = async ({
    targetModel,
    currentPrompt,
    requestedHelpModel,
    signal,
  }: PromptHelpOptions) => {
    const recoveryModels = resolveImagePromptHelpChatModels({
      provider,
      activeModel: model,
      requestedHelpModel,
    });
    if (!recoveryModels.length) return currentPrompt;

    const promptHelpRequest = buildImagePromptHelpRequest({
      targetImageModel: targetModel,
      prompt: currentPrompt,
    });
    for (const helpModel of recoveryModels) {
      try {
        const response = await fetch("/api/navy/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-api-key": apiKey,
          },
          body: JSON.stringify({
            model: helpModel,
            messages: [
              {
                role: "system",
                content:
                  "You are a production image-prompt editor. Return only one direct, policy-compliant image prompt. Preserve the user's named subject, identity, lawful intent, medium, composition, mood, and constraints. Make the primary subject visually dominant and keep secondary background detail subordinate.",
              },
              { role: "user", content: promptHelpRequest },
            ],
            toolChoice: "none",
            maxTokens: 2200,
          }),
          signal,
        });
        if (!response.ok) continue;
        const helpedPrompt = normalizeRecoveredImagePrompt(
          await readAssistantTextResponse(response),
        );
        if (
          helpedPrompt &&
          !areImagePromptsEquivalent(helpedPrompt, currentPrompt)
        ) {
          return helpedPrompt;
        }
      } catch (error) {
        if (isAbortLikeError(error, signal)) throw error;
      }
    }

    return currentPrompt;
  };

  return {
    callChatStreaming,
    recoverImagePromptAfterPolicyFailure,
    requestImagePromptHelp,
  };
};
