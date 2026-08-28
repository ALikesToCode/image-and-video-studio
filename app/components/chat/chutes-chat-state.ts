import {
  CHUTES_IMAGE_MODELS as STATIC_CHUTES_IMAGE_MODELS,
  CHUTES_LLM_MODELS as STATIC_CHUTES_LLM_MODELS,
  CHUTES_TTS_MODELS as STATIC_CHUTES_TTS_MODELS,
  CHUTES_VIDEO_MODELS as STATIC_CHUTES_VIDEO_MODELS,
  MULTILLM_AUDIO_MODELS as STATIC_MULTILLM_AUDIO_MODELS,
  MULTILLM_CHAT_MODELS as STATIC_MULTILLM_CHAT_MODELS,
  MULTILLM_IMAGE_MODELS as STATIC_MULTILLM_IMAGE_MODELS,
  MULTILLM_VIDEO_MODELS as STATIC_MULTILLM_VIDEO_MODELS,
  NANOGPT_IMAGE_MODELS as STATIC_NANOGPT_IMAGE_MODELS,
  NANOGPT_LLM_MODELS as STATIC_NANOGPT_LLM_MODELS,
  NANOGPT_VIDEO_MODELS as STATIC_NANOGPT_VIDEO_MODELS,
  NAVY_CHAT_MODELS as STATIC_NAVY_CHAT_MODELS,
  NAVY_IMAGE_MODELS as STATIC_NAVY_IMAGE_MODELS,
  NAVY_TTS_MODELS as STATIC_NAVY_TTS_MODELS,
  NAVY_VIDEO_MODELS as STATIC_NAVY_VIDEO_MODELS,
  type ChatProvider,
  type ModelOption,
} from "@/lib/constants";
import {
  sanitizeChatAttachmentAssets,
  sanitizeChatImageAssets,
  sanitizeChatMediaAssets,
} from "@/lib/chat-media-persistence";

import {
  DEFAULT_TOOL_SETTINGS,
  MAX_CHAT_MESSAGES,
  isChatTurnIntent,
  isReasoningEffort,
  type ChatMessage,
  type ReasoningEffort,
  type ToolCall,
  type ToolSettings,
} from "./chutes-chat-types";

export const getChatStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_history`;
export const getSystemPromptStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_system_prompt`;
export const getToolSettingsStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_tool_settings`;
export const getToolVideoModelStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_tool_video_model`;
export const getToolAudioModelStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_tool_audio_model`;
export const getReasoningPreferencesStorageKey = (
  provider: ChatProvider,
) => `studio_chat_${provider}_reasoning_preferences`;

export const sanitizeReasoningPreferences = (
  value: unknown,
): Record<string, ReasoningEffort> => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(
    value as Record<string, unknown>,
  ).reduce<Record<string, ReasoningEffort>>(
    (acc, [modelId, effort]) => {
      if (modelId.trim() && isReasoningEffort(effort)) {
        acc[modelId] = effort;
      }
      return acc;
    },
    {},
  );
};

export const sanitizeToolSettings = (
  value: unknown,
): ToolSettings => {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_TOOL_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  return {
    image:
      typeof record.image === "boolean"
        ? record.image
        : DEFAULT_TOOL_SETTINGS.image,
    video:
      typeof record.video === "boolean"
        ? record.video
        : DEFAULT_TOOL_SETTINGS.video,
    audio:
      typeof record.audio === "boolean"
        ? record.audio
        : DEFAULT_TOOL_SETTINGS.audio,
  };
};

export const sanitizeChatMessages = (
  value: unknown,
): ChatMessage[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const role = record.role;
      const content =
        typeof record.content === "string" ? record.content : "";
      if (!id) return null;
      if (
        role !== "user" &&
        role !== "assistant" &&
        role !== "tool"
      ) {
        return null;
      }

      const message: ChatMessage = { id, role, content };
      if (typeof record.thinking === "string") {
        message.thinking = record.thinking;
      }
      if (typeof record.promptUsed === "string") {
        message.promptUsed = record.promptUsed;
      }
      if (typeof record.toolCallId === "string") {
        message.toolCallId = record.toolCallId;
      }
      if (typeof record.name === "string") message.name = record.name;
      if (isChatTurnIntent(record.turnIntent)) {
        message.turnIntent = record.turnIntent;
      }
      if (record.usage && typeof record.usage === "object") {
        const usageRecord = record.usage as Record<string, unknown>;
        const usage = Object.fromEntries(
          [
            "inputTokens",
            "outputTokens",
            "totalTokens",
            "cachedInputTokens",
            "reasoningTokens",
          ]
            .map((key) => [key, usageRecord[key]])
            .filter(
              ([, value]) =>
                typeof value === "number" &&
                Number.isFinite(value) &&
                value >= 0,
            ),
        );
        if (Object.keys(usage).length) message.usage = usage;
      }

      if (Array.isArray(record.toolCalls)) {
        const toolCalls = record.toolCalls
          .map((toolCall): ToolCall | null => {
            if (!toolCall || typeof toolCall !== "object") return null;
            const toolCallRecord = toolCall as Record<string, unknown>;
            const toolCallId =
              typeof toolCallRecord.id === "string"
                ? toolCallRecord.id
                : "";
            const fn = toolCallRecord.function;
            if (!fn || typeof fn !== "object") return null;
            const fnRecord = fn as Record<string, unknown>;
            const fnName =
              typeof fnRecord.name === "string" ? fnRecord.name : "";
            const fnArgs =
              typeof fnRecord.arguments === "string"
                ? fnRecord.arguments
                : "";
            const extraContent =
              toolCallRecord.extra_content &&
              typeof toolCallRecord.extra_content === "object"
                ? (toolCallRecord.extra_content as Record<
                    string,
                    unknown
                  >)
                : null;
            const google =
              extraContent?.google &&
              typeof extraContent.google === "object"
                ? (extraContent.google as Record<string, unknown>)
                : null;
            const thoughtSignature =
              typeof google?.thought_signature === "string" &&
              google.thought_signature.length > 0 &&
              google.thought_signature.length <= 65_536
                ? google.thought_signature
                : null;
            if (!toolCallId || !fnName) return null;
            return {
              id: toolCallId,
              type: "function" as const,
              function: {
                name: fnName,
                arguments: fnArgs,
              },
              ...(thoughtSignature
                ? {
                    extra_content: {
                      google: {
                        thought_signature: thoughtSignature,
                      },
                    },
                  }
                : {}),
            };
          })
          .filter(
            (entry): entry is ToolCall => entry !== null,
          );
        if (toolCalls.length) message.toolCalls = toolCalls;
      }

      if (Array.isArray(record.images)) {
        const images = sanitizeChatImageAssets(record.images);
        if (images.length) message.images = images;
      }

      if (Array.isArray(record.media)) {
        const media = sanitizeChatMediaAssets(record.media);
        if (media.length) message.media = media;
      } else if (message.images?.length) {
        message.media = message.images.map((image) => ({
          id: image.id,
          kind: "image" as const,
          dataUrl: image.dataUrl,
          mimeType: image.mimeType,
          ...(image.model ? { model: image.model } : {}),
        }));
      }

      if (Array.isArray(record.attachments)) {
        const attachments = sanitizeChatAttachmentAssets(
          record.attachments,
        );
        if (attachments.length) {
          message.attachments = attachments;
        }
      }

      return message;
    })
    .filter((entry): entry is ChatMessage => !!entry)
    .slice(-MAX_CHAT_MESSAGES);
};

const idsFor = (models: ModelOption[]) =>
  new Set(models.map((model) => model.id));

const idsForGroups = (groups: ModelOption[][]) =>
  new Set(
    groups.flatMap((models) => models.map((model) => model.id)),
  );

export const STATIC_MODEL_IDS = {
  chutes: {
    chat: idsFor(STATIC_CHUTES_LLM_MODELS),
    image: idsForGroups([
      STATIC_CHUTES_IMAGE_MODELS,
      STATIC_NANOGPT_IMAGE_MODELS,
    ]),
    video: idsForGroups([
      STATIC_CHUTES_VIDEO_MODELS,
      STATIC_NANOGPT_VIDEO_MODELS,
    ]),
    audio: idsFor(STATIC_CHUTES_TTS_MODELS),
  },
  navy: {
    chat: idsFor(STATIC_NAVY_CHAT_MODELS),
    image: idsForGroups([
      STATIC_NAVY_IMAGE_MODELS,
      STATIC_NANOGPT_IMAGE_MODELS,
    ]),
    video: idsForGroups([
      STATIC_NAVY_VIDEO_MODELS,
      STATIC_NANOGPT_VIDEO_MODELS,
    ]),
    audio: idsFor(STATIC_NAVY_TTS_MODELS),
  },
  nanogpt: {
    chat: idsFor(STATIC_NANOGPT_LLM_MODELS),
    image: idsForGroups([
      STATIC_NANOGPT_IMAGE_MODELS,
      STATIC_NAVY_IMAGE_MODELS,
      STATIC_CHUTES_IMAGE_MODELS,
    ]),
    video: idsForGroups([
      STATIC_NANOGPT_VIDEO_MODELS,
      STATIC_NAVY_VIDEO_MODELS,
      STATIC_CHUTES_VIDEO_MODELS,
    ]),
    audio: new Set<string>(),
  },
  multillm: {
    chat: idsFor(STATIC_MULTILLM_CHAT_MODELS),
    image: idsFor(STATIC_MULTILLM_IMAGE_MODELS),
    video: idsFor(STATIC_MULTILLM_VIDEO_MODELS),
    audio: idsFor(STATIC_MULTILLM_AUDIO_MODELS),
  },
} satisfies Record<
  ChatProvider,
  Record<
    "chat" | "image" | "video" | "audio",
    Set<string>
  >
>;
