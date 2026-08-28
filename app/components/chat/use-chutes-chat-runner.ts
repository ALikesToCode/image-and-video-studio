"use client";

import {
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";

import type {
  ChatProvider,
} from "@/lib/constants";
import type { AIChatToolName } from "@/lib/ai-sdk-chat";
import type { ChatTokenUsage } from "@/lib/chat-metrics";
import {
  type ChatAttachmentAsset,
  type ChatTurnIntent,
  buildAssistantToolContextContent,
  createSyntheticFallbackToolCall,
  resolveChatTurnIntent,
  resolveChatTurnToolPolicy,
} from "@/lib/chat-tooling";

import {
  createChatId,
  isAbortLikeError,
} from "./chutes-chat-runtime";
import {
  MAX_CHAT_MODEL_STEPS,
  MAX_CHAT_TOOL_ROUNDS,
  type ChatMessage,
  type QueuedChatTurn,
  type ToolCall,
} from "./chutes-chat-types";

type ToolAvailability = {
  image: boolean;
  video: boolean;
  audio: boolean;
};

type ChatStreamResult = {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  usage?: ChatTokenUsage;
};

type ChatStreamCall = (
  messages: ChatMessage[],
  onUpdate: (update: {
    content?: string;
    thinking?: string;
    toolCalls?: ToolCall[];
  }) => void,
  toolChoiceOverride?: unknown,
  options?: {
    allowTools?: boolean;
    activeTools?: AIChatToolName[] | null;
    signal?: AbortSignal;
  },
) => Promise<ChatStreamResult>;

type HandleToolCalls = (
  toolCalls: ToolCall[],
  onProgress?: (message: ChatMessage) => void,
  context?: {
    assistantContent: string;
    userPrompt: string;
  },
  signal?: AbortSignal,
) => Promise<ChatMessage[]>;

type UseChutesChatRunnerOptions = {
  provider: ChatProvider;
  providerLabel: string;
  hasApiAccess: boolean;
  model: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  setTurnIntent: Dispatch<
    SetStateAction<ChatTurnIntent>
  >;
  currentTurnDecision: {
    intent: ChatTurnIntent;
    reason: string;
  };
  pendingAttachments: ChatAttachmentAsset[];
  setPendingAttachments: Dispatch<
    SetStateAction<ChatAttachmentAsset[]>
  >;
  setAttachmentError: Dispatch<
    SetStateAction<string | null>
  >;
  setChatError: Dispatch<
    SetStateAction<string | null>
  >;
  messagesRef: MutableRefObject<ChatMessage[]>;
  commitMessages: (messages: ChatMessage[]) => void;
  toolAvailability: ToolAvailability;
  toolImageModel: string;
  imagePipelineEnabled: boolean;
  toolVideoModel: string;
  toolAudioModel: string;
  videoImage?: string | null;
  videoAspect?: string;
  videoDuration?: string;
  ttsVoice?: string;
  ttsFormat?: string;
  ttsSpeed?: string;
  callChatStreaming: ChatStreamCall;
  handleToolCalls: HandleToolCalls;
};

export const useChutesChatRunner = ({
  provider,
  providerLabel,
  hasApiAccess,
  model,
  input,
  setInput,
  setTurnIntent,
  currentTurnDecision,
  pendingAttachments,
  setPendingAttachments,
  setAttachmentError,
  setChatError,
  messagesRef,
  commitMessages,
  toolAvailability,
  toolImageModel,
  imagePipelineEnabled,
  toolVideoModel,
  toolAudioModel,
  videoImage,
  videoAspect,
  videoDuration,
  ttsVoice,
  ttsFormat,
  ttsSpeed,
  callChatStreaming,
  handleToolCalls,
}: UseChutesChatRunnerOptions) => {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const chatAbortControllerRef =
    useRef<AbortController | null>(null);
  const queuedTurnsRef = useRef<QueuedChatTurn[]>([]);
  const [queuedTurns, setQueuedTurns] = useState<
    QueuedChatTurn[]
  >([]);

  const setChatBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const updateQueuedTurns = useCallback(
    (
      updater:
        | QueuedChatTurn[]
        | ((
            previous: QueuedChatTurn[],
          ) => QueuedChatTurn[]),
    ) => {
      const nextTurns =
        typeof updater === "function"
          ? updater(queuedTurnsRef.current)
          : updater;
      queuedTurnsRef.current = nextTurns;
      setQueuedTurns(nextTurns);
      return nextTurns;
    },
    [],
  );

  const enqueueChatTurn = useCallback(
    (
      content: string,
      attachments: ChatAttachmentAsset[],
      queuedTurnIntent: ChatTurnIntent,
    ) => {
      updateQueuedTurns((previous) => [
        ...previous,
        {
          id: createChatId(),
          content,
          attachments,
          turnIntent: queuedTurnIntent,
        },
      ]);
    },
    [updateQueuedTurns],
  );

  const takeNextQueuedTurn =
    useCallback((): QueuedChatTurn | null => {
      let nextTurn: QueuedChatTurn | null = null;
      updateQueuedTurns((previous) => {
        if (!previous.length) return previous;
        const [head, ...rest] = previous;
        nextTurn = head;
        return rest;
      });
      return nextTurn;
    }, [updateQueuedTurns]);

  const runChatTurn = async (
    prompt: string,
    attachments: ChatAttachmentAsset[] = [],
    submittedIntent: ChatTurnIntent = "auto",
  ) => {
    if (!hasApiAccess) {
      setChatError(
        `Add your ${providerLabel} API key in settings.`,
      );
      const nextTurn = takeNextQueuedTurn();
      if (nextTurn) {
        void runChatTurn(
          nextTurn.content,
          nextTurn.attachments,
          nextTurn.turnIntent,
        );
      } else {
        setChatBusy(false);
      }
      return;
    }
    if (!model) {
      setChatError("Select a chat model.");
      const nextTurn = takeNextQueuedTurn();
      if (nextTurn) {
        void runChatTurn(
          nextTurn.content,
          nextTurn.attachments,
          nextTurn.turnIntent,
        );
      } else {
        setChatBusy(false);
      }
      return;
    }

    setChatError(null);
    setChatBusy(true);
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;
    const userMessage: ChatMessage = {
      id: createChatId(),
      role: "user",
      content:
        prompt ||
        "Please analyze the attached file(s).",
      attachments,
      turnIntent: submittedIntent,
    };
    let currentMessages: ChatMessage[] = [
      ...messagesRef.current,
      userMessage,
    ];
    commitMessages(currentMessages);

    const turnDecision = resolveChatTurnIntent(
      prompt,
      toolAvailability,
      submittedIntent,
    );
    const turnToolPolicy =
      resolveChatTurnToolPolicy(turnDecision);
    const forcedToolCall =
      turnToolPolicy.forcedToolCall;
    let toolRounds = 0;

    try {
      for (
        let step = 0;
        step < MAX_CHAT_MODEL_STEPS;
        step += 1
      ) {
        const allowTools =
          toolRounds < MAX_CHAT_TOOL_ROUNDS &&
          turnToolPolicy.activeTools?.length !== 0;
        const assistantId = createChatId();
        currentMessages = [
          ...currentMessages,
          {
            id: assistantId,
            role: "assistant",
            content: "",
          },
        ];
        commitMessages(currentMessages);

        const finalResult =
          await callChatStreaming(
            currentMessages.slice(0, -1),
            (update) => {
              currentMessages = currentMessages.map(
                (message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        content:
                          update.content ??
                          message.content,
                        thinking:
                          update.thinking ??
                          message.thinking,
                        toolCalls:
                          update.toolCalls ??
                          message.toolCalls,
                      }
                    : message,
              );
              commitMessages(currentMessages);
            },
            step === 0 &&
              forcedToolCall &&
              allowTools
              ? {
                  type: "function",
                  function: {
                    name: forcedToolCall,
                  },
                }
              : undefined,
            {
              allowTools,
              activeTools:
                turnToolPolicy.activeTools,
              signal: abortController.signal,
            },
          );

        const finalToolCalls =
          finalResult.toolCalls.filter(
            (call) =>
              call.id && call.function.name,
          );
        const assistantToolContext =
          buildAssistantToolContextContent({
            content: finalResult.content,
            thinking: finalResult.thinking,
          });
        const finalizedAssistant: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: finalResult.content,
          thinking:
            finalResult.thinking || undefined,
          toolCalls: finalToolCalls.length
            ? finalToolCalls
            : undefined,
          usage: finalResult.usage,
        };
        currentMessages = [
          ...currentMessages.slice(0, -1),
          finalizedAssistant,
        ];
        commitMessages(currentMessages);

        const applyProgressMessage = (
          message: ChatMessage,
        ) => {
          currentMessages = currentMessages.some(
            (item) => item.id === message.id,
          )
            ? currentMessages.map((item) =>
                item.id === message.id
                  ? message
                  : item,
              )
            : [...currentMessages, message];
          commitMessages(currentMessages);
        };
        const removeProgressMessages = (
          completedToolCalls: ToolCall[],
        ) => {
          const completedIds = new Set(
            completedToolCalls
              .map((call) => call.id)
              .filter(Boolean),
          );
          if (!completedIds.size) return;
          currentMessages = currentMessages.filter(
            (message) =>
              !(
                message.transient &&
                message.toolCallId &&
                completedIds.has(
                  message.toolCallId,
                )
              ),
          );
          commitMessages(currentMessages);
        };

        if (!finalToolCalls.length) {
          if (
            step === 0 &&
            forcedToolCall &&
            turnToolPolicy.allowSyntheticFallback
          ) {
            const fallbackToolCall =
              createSyntheticFallbackToolCall({
                requestedTool: forcedToolCall,
                provider,
                userPrompt: prompt,
                assistantContent:
                  assistantToolContext,
                imageModel: toolImageModel,
                imagePipelineEnabled,
                videoModel: toolVideoModel,
                audioModel: toolAudioModel,
                videoImage,
                videoAspect,
                videoDuration,
                ttsVoice,
                ttsFormat,
                ttsSpeed,
              });
            if (fallbackToolCall) {
              const syntheticToolCall: ToolCall = {
                id: createChatId(),
                type: "function",
                function: {
                  name: fallbackToolCall.name,
                  arguments: JSON.stringify(
                    fallbackToolCall.arguments,
                  ),
                },
              };
              currentMessages = [
                ...currentMessages.slice(0, -1),
                {
                  ...finalizedAssistant,
                  toolCalls: [syntheticToolCall],
                },
              ];
              commitMessages(currentMessages);
              const toolMessages =
                await handleToolCalls(
                  [syntheticToolCall],
                  applyProgressMessage,
                  {
                    assistantContent:
                      assistantToolContext,
                    userPrompt: prompt,
                  },
                  abortController.signal,
                );
              if (toolMessages.length) {
                removeProgressMessages([
                  syntheticToolCall,
                ]);
                currentMessages = [
                  ...currentMessages,
                  ...toolMessages,
                ];
                commitMessages(currentMessages);
                toolRounds += 1;
                continue;
              }
            }
          }
          break;
        }

        const toolMessages = await handleToolCalls(
          finalToolCalls,
          applyProgressMessage,
          {
            assistantContent: assistantToolContext,
            userPrompt: prompt,
          },
          abortController.signal,
        );
        removeProgressMessages(finalToolCalls);
        currentMessages = [
          ...currentMessages,
          ...toolMessages,
        ];
        commitMessages(currentMessages);
        toolRounds += 1;
      }
    } catch (error) {
      if (
        !isAbortLikeError(
          error,
          abortController.signal,
        )
      ) {
        setChatError(
          error instanceof Error
            ? error.message
            : "Unable to run chat.",
        );
      }
    } finally {
      if (
        chatAbortControllerRef.current ===
        abortController
      ) {
        chatAbortControllerRef.current = null;
      }
      const nextTurn = takeNextQueuedTurn();
      if (nextTurn) {
        void runChatTurn(
          nextTurn.content,
          nextTurn.attachments,
          nextTurn.turnIntent,
        );
      } else {
        setChatBusy(false);
      }
    }
  };

  const submitMessage = () => {
    const prompt = input.trim();
    const attachments = pendingAttachments;
    if (!prompt && !attachments.length) return;
    if (!hasApiAccess) {
      setChatError(
        `Add your ${providerLabel} API key in settings.`,
      );
      return;
    }
    if (!model) {
      setChatError("Select a chat model.");
      return;
    }

    setChatError(null);
    setInput("");
    setTurnIntent("auto");
    setPendingAttachments([]);
    setAttachmentError(null);
    if (
      busyRef.current ||
      queuedTurnsRef.current.length
    ) {
      enqueueChatTurn(
        prompt,
        attachments,
        currentTurnDecision.intent,
      );
      return;
    }
    void runChatTurn(
      prompt,
      attachments,
      currentTurnDecision.intent,
    );
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      submitMessage();
    }
  };

  const stopChat = () => {
    updateQueuedTurns([]);
    chatAbortControllerRef.current?.abort();
  };

  const clearQueue = () => {
    updateQueuedTurns([]);
  };

  return {
    busy,
    queuedTurns,
    submitMessage,
    handleKeyDown,
    stopChat,
    clearQueue,
  };
};
