import type {
  ModelOption,
  Provider,
} from "@/lib/constants";
import {
  type ChatImageAsset,
  type ChatMediaAsset,
  sanitizeChatImageAssets,
  sanitizeChatMediaAssets,
} from "@/lib/chat-media-persistence";
import { buildCancelledToolResults } from "@/lib/chat-turn-policy";
import {
  repairImageToolArguments,
  resolveToolArguments,
} from "@/lib/chat-tool-prompts";

import type { ImageToolProgress } from "./chutes-chat-image-tool";
import {
  createChatId,
  getStringArg,
  isAbortLikeError,
} from "./chutes-chat-runtime";
import type {
  ChatMessage,
  ToolCall,
  ToolSettings,
} from "./chutes-chat-types";

type ToolContext = {
  assistantContent: string;
  userPrompt: string;
};

type ImageToolResult = {
  images: ChatImageAsset[];
  model: string;
  prompt: string;
  errors: string[];
};

type MediaToolResult = {
  media: ChatMediaAsset[];
  model: string;
  prompt: string;
};

type ChatToolRunnerOptions = {
  provider: Provider;
  toolSettings: ToolSettings;
  imageModels: ModelOption[];
  videoModels: ModelOption[];
  audioModels: ModelOption[];
  onGeneratedImage: (dataUrl: string) => void;
  saveToGallery: boolean;
  onSaveImages?: (payload: {
    images: ChatImageAsset[];
    prompt: string;
    model: string;
    provider: Provider;
  }) => Promise<void> | void;
  refreshMediaUsage: () => void;
  runImage: (
    args: Record<string, unknown>,
    context?: ToolContext,
    onProgress?: (update: ImageToolProgress) => void,
    signal?: AbortSignal,
  ) => Promise<ImageToolResult>;
  runVideo: (
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<MediaToolResult>;
  runAudio: (
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<MediaToolResult>;
};

const toolErrorMessage = (
  toolCall: ToolCall,
  content: string,
  promptUsed?: string,
): ChatMessage => ({
  id: createChatId(),
  role: "tool",
  content,
  promptUsed,
  toolCallId: toolCall.id,
  name: toolCall.function?.name || undefined,
});

export const runChatTools = async (
  {
    provider,
    toolSettings,
    imageModels,
    videoModels,
    audioModels,
    onGeneratedImage,
    saveToGallery,
    onSaveImages,
    refreshMediaUsage,
    runImage,
    runVideo,
    runAudio,
  }: ChatToolRunnerOptions,
  toolCalls: ToolCall[],
  onProgress?: (message: ChatMessage) => void,
  context?: ToolContext,
  signal?: AbortSignal,
) => {
    const toolMessages: ChatMessage[] = [];
    const orderedToolCalls = [
      ...toolCalls.filter(
        (call) =>
          call.function?.name !== "generate_video",
      ),
      ...toolCalls.filter(
        (call) =>
          call.function?.name === "generate_video",
      ),
    ];

    for (const toolCall of orderedToolCalls) {
      const toolName =
        toolCall.function?.name ?? "";
      let args: Record<string, unknown> = {};

      if (toolCall.input_error) {
        toolMessages.push(
          toolErrorMessage(
            toolCall,
            `Tool error: Invalid tool arguments. ${toolCall.input_error}`,
          ),
        );
        continue;
      }

      try {
        args = resolveToolArguments({
          toolName,
          rawArgs:
            toolCall.function?.arguments ?? "",
          context,
        }).args;
      } catch {
        toolMessages.push(
          toolErrorMessage(
            toolCall,
            "Tool error: Invalid tool arguments.",
          ),
        );
        continue;
      }

      if (toolName === "generate_image" && context) {
        args = repairImageToolArguments(args, context);
      }
      const invocationPrompt = getStringArg(args, [
        "prompt",
        "input",
        "text",
      ]);
      const disabledByUser =
        (toolName === "generate_image" &&
          (!toolSettings.image ||
            !imageModels.length)) ||
        (toolName === "generate_video" &&
          (!toolSettings.video ||
            !videoModels.length)) ||
        (toolName === "generate_audio" &&
          (!toolSettings.audio ||
            !audioModels.length));
      if (disabledByUser) {
        toolMessages.push(
          toolErrorMessage(
            toolCall,
            `Tool error: ${toolName} is currently disabled.`,
            invocationPrompt || undefined,
          ),
        );
        continue;
      }

      try {
        if (toolName) {
          onProgress?.({
            id: `${toolCall.id}:invoking`,
            role: "tool",
            content: `Invoking ${toolName}…`,
            promptUsed:
              invocationPrompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            transient: true,
          });
        }

        if (toolName === "generate_image") {
          const result = await runImage(
            args,
            context,
            (update) => {
              const imageCount =
                update.images?.length ?? 0;
              const attemptLabel =
                update.maxAttempts &&
                update.maxAttempts > 1 &&
                update.attempt
                  ? ` (try ${update.attempt}/${update.maxAttempts})`
                  : "";
              const content =
                update.status === "refining"
                  ? `Asking a stronger chat model to refine the prompt before generating with ${update.model}…`
                  : update.status === "running"
                  ? `Generating image with ${update.model}${attemptLabel}…`
                  : update.status === "rewriting"
                    ? `Rephrasing prompt for ${update.model}${attemptLabel} after safety rejection…`
                    : update.status === "success"
                      ? `Generated ${imageCount} image${imageCount === 1 ? "" : "s"} with ${update.model}.`
                      : `Image generation failed with ${update.model}${attemptLabel}: ${update.error ?? "Unknown error."}`;
              const safeImages =
                sanitizeChatImageAssets(
                  update.images,
                );
              onProgress?.({
                id: `${toolCall.id}:image:${update.model}`,
                role: "tool",
                content,
                promptUsed:
                  update.prompt || undefined,
                toolCallId: toolCall.id,
                name: toolName,
                images: safeImages.length
                  ? safeImages
                  : undefined,
                media: safeImages.map((image) => ({
                  ...image,
                  kind: "image" as const,
                })),
                transient: true,
              });
            },
            signal,
          );
          const safeImages =
            sanitizeChatImageAssets(result.images);
          if (!safeImages.length) {
            throw new Error(
              "Image provider returned no safe media.",
            );
          }
          if (safeImages[0]?.dataUrl) {
            onGeneratedImage(safeImages[0].dataUrl);
          }

          if (saveToGallery && onSaveImages) {
            const imagesByProvider = new Map<
              Provider,
              ChatImageAsset[]
            >();
            for (const image of safeImages) {
              const targetProvider =
                image.provider ?? provider;
              imagesByProvider.set(targetProvider, [
                ...(imagesByProvider.get(
                  targetProvider,
                ) ?? []),
                image,
              ]);
            }
            for (const [
              targetProvider,
              images,
            ] of imagesByProvider) {
              await onSaveImages({
                images,
                prompt: result.prompt,
                model:
                  Array.from(
                    new Set(
                      images
                        .map((image) => image.model)
                        .filter(Boolean),
                    ),
                  ).join(", ") || result.model,
                provider: targetProvider,
              });
            }
          }

          refreshMediaUsage();
          const imageStatus = result.errors.length
            ? `Generated ${safeImages.length} image(s) using ${result.model}. Failed: ${result.errors.join("; ")}`
            : `Generated ${safeImages.length} image(s) using ${result.model}.`;
          toolMessages.push({
            id: createChatId(),
            role: "tool",
            content: imageStatus,
            promptUsed: result.prompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            images: safeImages,
            media: safeImages.map((image) => ({
              ...image,
              kind: "image" as const,
            })),
          });
          continue;
        }

        if (toolName === "generate_video") {
          const result = await runVideo(args, signal);
          const safeMedia =
            sanitizeChatMediaAssets(result.media);
          if (!safeMedia.length) {
            throw new Error(
              "Video provider returned no safe media.",
            );
          }
          refreshMediaUsage();
          toolMessages.push({
            id: createChatId(),
            role: "tool",
            content: `Video generated using ${result.model}.`,
            promptUsed: result.prompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            media: safeMedia,
          });
          continue;
        }

        if (toolName === "generate_audio") {
          const result = await runAudio(args, signal);
          const safeMedia =
            sanitizeChatMediaAssets(result.media);
          if (!safeMedia.length) {
            throw new Error(
              "Audio provider returned no safe media.",
            );
          }
          toolMessages.push({
            id: createChatId(),
            role: "tool",
            content: `Audio generated using ${result.model}.`,
            promptUsed: result.prompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            media: safeMedia,
          });
          continue;
        }

        toolMessages.push(
          toolErrorMessage(
            toolCall,
            "Tool error: Unknown tool call.",
            invocationPrompt || undefined,
          ),
        );
      } catch (error) {
        if (isAbortLikeError(error, signal)) {
          const completedToolCallIds = toolMessages
            .map((message) => message.toolCallId)
            .filter(
              (id): id is string => Boolean(id),
            );
          toolMessages.push(
            ...buildCancelledToolResults(
              orderedToolCalls,
              completedToolCallIds,
            ).map((result) => ({
              id: createChatId(),
              role: "tool" as const,
              ...result,
            })),
          );
          return toolMessages;
        }
        toolMessages.push(
          toolErrorMessage(
            toolCall,
            `Tool error: ${
              error instanceof Error
                ? error.message
                : "Tool failed."
            }`,
            invocationPrompt || undefined,
          ),
        );
      }
    }
  return toolMessages;
};
