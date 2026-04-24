import type { ChatProvider } from "./constants.ts";
import { resolveActiveImageToolModels } from "./studio-generation.ts";

export type ToolAvailability = {
  image: boolean;
  video: boolean;
  audio: boolean;
};

export type ForcedToolCall =
  | "generate_image"
  | "generate_video"
  | "generate_audio"
  | null;

export type ChatImageAsset = {
  id: string;
  dataUrl: string;
  mimeType: string;
  model?: string;
};

export type ChatMediaAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  dataUrl: string;
  mimeType: string;
  model?: string;
};

type SyntheticFallbackToolCallOptions = {
  requestedTool: ForcedToolCall;
  provider: ChatProvider;
  userPrompt: string;
  assistantContent: string;
  imageModel: string;
  imagePipelineEnabled?: boolean;
  videoModel: string;
  audioModel: string;
  videoImage?: string | null;
  videoAspect?: string | null;
  videoDuration?: string | number | null;
  ttsVoice?: string | null;
  ttsFormat?: string | null;
  ttsSpeed?: string | number | null;
};

type SyntheticFallbackToolCall = {
  name: Exclude<ForcedToolCall, null>;
  arguments: Record<string, unknown>;
};

const normalizeValue = (value: string) => value.trim().replace(/\r\n/g, "\n");

const extractTaggedBlock = (assistantContent: string, labels: string[]) => {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}:\\s*([\\s\\S]*?)(?:\\n(?:final [^\\n:]+|negative prompt|video readiness|audio mood|script|prompt):|\\n\\s*\\n|$)`,
      "i"
    );
    const match = assistantContent.match(pattern);
    if (!match?.[1]) continue;
    const candidate = match[1]
      .replace(/^\s*[-*]\s*/gm, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (candidate.length > 3) {
      return candidate;
    }
  }
  return "";
};

const coercePositiveNumber = (value?: string | number | null) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

export const sanitizeChatImageAssets = (value: unknown): ChatImageAsset[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((img) => {
      if (!img || typeof img !== "object") return null;
      const imgRecord = img as Record<string, unknown>;
      const id = typeof imgRecord.id === "string" ? imgRecord.id : "";
      const dataUrl =
        typeof imgRecord.dataUrl === "string" ? imgRecord.dataUrl : "";
      const mimeType =
        typeof imgRecord.mimeType === "string" ? imgRecord.mimeType : "image/png";
      const model =
        typeof imgRecord.model === "string" && imgRecord.model.trim()
          ? imgRecord.model.trim()
          : undefined;
      if (!id || !dataUrl) return null;
      return { id, dataUrl, mimeType, ...(model ? { model } : {}) };
    })
    .filter((entry): entry is ChatImageAsset => !!entry);
};

export const sanitizeChatMediaAssets = (value: unknown): ChatMediaAsset[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const mediaRecord = item as Record<string, unknown>;
      const id = typeof mediaRecord.id === "string" ? mediaRecord.id : "";
      const kind = mediaRecord.kind;
      const dataUrl =
        typeof mediaRecord.dataUrl === "string" ? mediaRecord.dataUrl : "";
      const mimeType =
        typeof mediaRecord.mimeType === "string" ? mediaRecord.mimeType : "";
      const model =
        typeof mediaRecord.model === "string" && mediaRecord.model.trim()
          ? mediaRecord.model.trim()
          : undefined;
      if (!id || !dataUrl) return null;
      if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
      return {
        id,
        kind,
        dataUrl,
        mimeType:
          mimeType ||
          (kind === "video"
            ? "video/mp4"
            : kind === "audio"
              ? "audio/mpeg"
              : "image/png"),
        ...(model ? { model } : {}),
      };
    })
    .filter((entry): entry is ChatMediaAsset => !!entry);
};

export const detectForcedToolCall = (
  text: string,
  toolSettings: ToolAvailability
): ForcedToolCall => {
  const normalized = text.toLowerCase();
  const explicitGenerate =
    /\b(generate|create|make|render|produce|draw|animate|convert|turn|read|speak|narrate)\b/.test(
      normalized
    ) || /\bnow\b/.test(normalized);
  if (!explicitGenerate) return null;

  const videoIntent =
    /\b(video|clip|animate|animation|movie)\b/.test(normalized) ||
    /\bturn .* into .*video\b/.test(normalized);
  const audioIntent =
    /\b(audio|voice|speech|tts|narration|read aloud|read this|speak this)\b/.test(
      normalized
    ) || /\bturn .* into .*speech\b/.test(normalized);
  const imageIntent =
    /\b(image|picture|photo|art|illustration|render)\b/.test(normalized) ||
    /\bflux\b/.test(normalized) ||
    /\bdall[- ]?e\b/.test(normalized);

  if (videoIntent && toolSettings.video) return "generate_video";
  if (audioIntent && toolSettings.audio) return "generate_audio";
  if (imageIntent && toolSettings.image) return "generate_image";
  if (toolSettings.image) return "generate_image";
  return null;
};

export const extractPromptForFallback = (
  assistantContent: string,
  userPrompt: string
) => {
  const candidate = extractTaggedBlock(assistantContent, [
    "final flux prompt",
    "final image prompt",
    "final video prompt",
    "final prompt",
    "prompt",
  ]);
  return candidate || normalizeValue(userPrompt);
};

export const extractAudioInputForFallback = (
  assistantContent: string,
  userPrompt: string
) => {
  const candidate = extractTaggedBlock(assistantContent, [
    "final script",
    "final narration",
    "final audio input",
    "speech",
    "script",
  ]);
  return candidate || normalizeValue(userPrompt);
};

export const resolveRequestedImageModels = ({
  requestedModel,
  defaultModel,
  imagePipelineEnabled,
  imageModelOrder,
  availableModels,
}: {
  requestedModel: string;
  defaultModel: string;
  imagePipelineEnabled: boolean;
  imageModelOrder: string[];
  availableModels: string[];
}) => {
  const normalizedRequestedModel = requestedModel.trim();
  const normalizedDefaultModel = defaultModel.trim();

  if (
    normalizedRequestedModel &&
    normalizedRequestedModel !== normalizedDefaultModel
  ) {
    return availableModels.includes(normalizedRequestedModel)
      ? [normalizedRequestedModel]
      : [];
  }

  return resolveActiveImageToolModels({
    pipelineEnabled: imagePipelineEnabled,
    preferredModels: imageModelOrder,
    fallbackModel: normalizedDefaultModel,
    availableModels,
  });
};

export const createSyntheticFallbackToolCall = ({
  requestedTool,
  provider,
  userPrompt,
  assistantContent,
  imageModel,
  imagePipelineEnabled,
  videoModel,
  audioModel,
  videoImage,
  videoAspect,
  videoDuration,
  ttsVoice,
  ttsFormat,
  ttsSpeed,
}: SyntheticFallbackToolCallOptions): SyntheticFallbackToolCall | null => {
  if (!requestedTool) return null;

  if (requestedTool === "generate_image") {
    return {
      name: "generate_image",
      arguments: {
        prompt: extractPromptForFallback(assistantContent, userPrompt),
        ...(imagePipelineEnabled ? {} : { model: imageModel }),
      },
    };
  }

  if (requestedTool === "generate_video") {
    const prompt = extractPromptForFallback(assistantContent, userPrompt);
    if (provider === "chutes") {
      if (!videoImage?.trim()) return null;
      return {
        name: "generate_video",
        arguments: {
          prompt,
          model: videoModel,
          image: videoImage.trim(),
        },
      };
    }

    const args: Record<string, unknown> = {
      prompt,
      model: videoModel,
    };
    if (videoAspect?.trim()) {
      args.size = videoAspect.trim();
    }
    const seconds = coercePositiveNumber(videoDuration);
    if (seconds !== null) {
      args.seconds = seconds;
    }
    if (videoImage?.trim()) {
      args.image_url = videoImage.trim();
    }
    return {
      name: "generate_video",
      arguments: args,
    };
  }

  const input = extractAudioInputForFallback(assistantContent, userPrompt);
  const speed = coercePositiveNumber(ttsSpeed);

  if (provider === "chutes") {
    return {
      name: "generate_audio",
      arguments: {
        text: input,
        model: audioModel,
        ...(speed !== null ? { speed } : {}),
      },
    };
  }

  return {
    name: "generate_audio",
    arguments: {
      input,
      model: audioModel,
      ...(ttsVoice?.trim() ? { voice: ttsVoice.trim() } : {}),
      ...(ttsFormat?.trim() ? { response_format: ttsFormat.trim() } : {}),
      ...(speed !== null ? { speed } : {}),
    },
  };
};

export const stripHeavyMediaFromMessagesForStorage = <
  T extends { images?: unknown; media?: unknown }
>(
  messages: T[],
  maxMessages: number
) =>
  messages.slice(-maxMessages).map((message) => {
    const clonedMessage = { ...message };
    delete clonedMessage.images;
    delete clonedMessage.media;
    return clonedMessage;
  });
