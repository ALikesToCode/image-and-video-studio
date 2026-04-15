import type { ChatProvider } from "./constants.ts";

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

type SyntheticFallbackToolCallOptions = {
  requestedTool: ForcedToolCall;
  provider: ChatProvider;
  userPrompt: string;
  assistantContent: string;
  imageModel: string;
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

export const createSyntheticFallbackToolCall = ({
  requestedTool,
  provider,
  userPrompt,
  assistantContent,
  imageModel,
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
        model: imageModel,
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
