import {
  DefaultChatTransport,
  readUIMessageStream,
} from "ai";

import type { ChatProvider } from "@/lib/constants";
import {
  extractAIChatStreamState,
  type AIChatToolName,
} from "@/lib/ai-sdk-chat";
import {
  isDeepSeekV4Model,
  toChatCompletionMessages,
} from "@/lib/chat-completion";
import { selectChatContextMessages } from "@/lib/chat-context-budget";
import { readAssistantTextResponseResult } from "@/lib/client/chat-stream-text";
import {
  resolvePromptRewriteOutputTokenBudgets,
  resolveStudioChatOutputTokenBudgets,
} from "@/lib/llm-output-budget";
import {
  areImagePromptsEquivalent,
  buildImagePolicyRecoveryPrompt,
  buildImagePromptHelpRequest,
  buildImageRetryFallbackPrompt,
  resolveImagePromptHelpChatModels,
  resolveImagePromptRecoveryChatModels,
  type ImagePromptHelpModel,
} from "@/lib/studio-generation";

import {
  createChatId,
  isAbortLikeError,
} from "./chutes-chat-runtime";
import type {
  ChatMessage,
  ReasoningEffort,
  ToolCall,
} from "./chutes-chat-types";
import type { ChatTokenUsage } from "@/lib/chat-metrics";

type ChatStreamClientOptions = {
  apiKey: string;
  provider: ChatProvider;
  model: string;
  systemPrompt: string;
  enabledTools: AIChatToolName[];
  reasoningEffort: ReasoningEffort;
  supportsReasoning: boolean;
  isDeepSeekV4Model: boolean;
  modelMaxOutputTokens?: number | null;
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
  modelMaxOutputTokens,
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
    const tokenBudgets = resolveStudioChatOutputTokenBudgets({
      hasTools: requestTools.length > 0,
      modelMaxOutputTokens,
    });

    for (const [attemptIndex, maxTokens] of tokenBudgets.entries()) {
      const hasRetry = attemptIndex < tokenBudgets.length - 1;
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
                selectChatContextMessages(items),
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
            maxTokens,
            ...reasoningPayload,
          },
        }),
      });

      try {
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
          finishReason: null as string | null,
          usage: undefined as ChatTokenUsage | undefined,
          outputTokenLimitReached: false,
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

        const invalidToolInput = finalState.toolCalls.some(
          (call) => Boolean(call.input_error),
        );
        if (finalState.outputTokenLimitReached || invalidToolInput) {
          onUpdate({ content: "", thinking: "", toolCalls: [] });
          if (hasRetry) continue;
          throw new Error(
            finalState.outputTokenLimitReached
              ? "The model reached its output limit before completing the response. No partial prompt was sent. Choose a model with a larger output limit or shorten the request."
              : "The model returned invalid tool arguments after one retry. No generation request was sent.",
          );
        }
        if (finalState.toolErrors.length) {
          throw new Error(finalState.toolErrors.join(" "));
        }
        return {
          content: finalState.content,
          thinking: finalState.thinking,
          toolCalls: finalState.toolCalls,
          usage: finalState.usage,
        };
      } catch (error) {
        if (isAbortLikeError(error, options.signal)) throw error;
        const retryableInvalidToolError =
          error instanceof Error &&
          /(?:invalid tool|tool (?:call|arguments?).*invalid|called a tool with invalid)/i.test(
            error.message,
          );
        if (hasRetry && retryableInvalidToolError) {
          onUpdate({ content: "", thinking: "", toolCalls: [] });
          continue;
        }
        throw error;
      }
    }

    throw new Error("Chat completion failed before producing a response.");
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
    const tokenBudgets =
      resolvePromptRewriteOutputTokenBudgets(currentPrompt);

    for (const recoveryModel of recoveryModels) {
      for (const maxTokens of tokenBudgets) {
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
              maxTokens,
              ...(provider === "navy" &&
              isDeepSeekV4Model(recoveryModel)
                ? { thinking: { type: "disabled" } }
                : {}),
            }),
            signal,
          });
          if (!response.ok) break;
          const result = await readAssistantTextResponseResult(response);
          if (result.outputTokenLimitReached) continue;
          const recoveredPrompt = normalizeRecoveredImagePrompt(result.text);
          if (
            recoveredPrompt &&
            !areImagePromptsEquivalent(recoveredPrompt, currentPrompt)
          ) {
            return recoveredPrompt;
          }
          break;
        } catch (error) {
          if (isAbortLikeError(error, signal)) throw error;
          break;
        }
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
    const tokenBudgets =
      resolvePromptRewriteOutputTokenBudgets(currentPrompt);
    for (const helpModel of recoveryModels) {
      for (const maxTokens of tokenBudgets) {
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
                    "You are a production image-prompt editor. Return only one direct visual prompt containing the renderable scene and direct visual constraints. Preserve the user's named subject, identity, lawful intent, requested medium, composition, mood, and constraints. Make the primary subject visually dominant and keep secondary background detail subordinate. Never include prompt-writing guidance, model or provider names, policy or safety commentary, retry language, or invisible instructions. Treat the requested medium as authoritative and never add conflicting photography or realism cues unless the user explicitly requests a hybrid.",
                },
                { role: "user", content: promptHelpRequest },
              ],
              toolChoice: "none",
              maxTokens,
            }),
            signal,
          });
          if (!response.ok) break;
          const result = await readAssistantTextResponseResult(response);
          if (result.outputTokenLimitReached) continue;
          const helpedPrompt = normalizeRecoveredImagePrompt(result.text);
          if (
            helpedPrompt &&
            !areImagePromptsEquivalent(helpedPrompt, currentPrompt)
          ) {
            return helpedPrompt;
          }
          break;
        } catch (error) {
          if (isAbortLikeError(error, signal)) throw error;
          break;
        }
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
