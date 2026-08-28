import type { ChatProvider } from "./constants.ts";
import {
  extractAudioInputForFallback,
  extractPromptForFallback,
} from "./chat-tool-prompts.ts";

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

export type MediaToolCall = Exclude<ForcedToolCall, null>;

export type ChatTurnIntent = "auto" | "chat" | MediaToolCall;

export type ChatTurnIntentDecision = {
  intent: ChatTurnIntent;
  source: "auto" | "manual";
  reason: string;
};

export type ChatTurnToolPolicy = {
  activeTools: MediaToolCall[] | null;
  forcedToolCall: MediaToolCall | null;
  allowSyntheticFallback: boolean;
};

type ToolCallIdentity = {
  id?: string;
  function?: { name?: string };
};

export const buildCancelledToolResults = (
  toolCalls: ToolCallIdentity[],
  completedToolCallIds: Iterable<string> = [],
) => {
  const completed = new Set(completedToolCallIds);
  return toolCalls
    .filter(
      (toolCall): toolCall is ToolCallIdentity & { id: string } =>
        typeof toolCall.id === "string" &&
        Boolean(toolCall.id) &&
        !completed.has(toolCall.id),
    )
    .map((toolCall) => ({
      toolCallId: toolCall.id,
      ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
      content: "Tool error: Cancelled by the user.",
    }));
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

const mediaIntentAvailability = (
  intent: MediaToolCall,
  toolSettings: ToolAvailability
) => {
  if (intent === "generate_image") return toolSettings.image;
  if (intent === "generate_video") return toolSettings.video;
  return toolSettings.audio;
};

const mediaIntentLabel = (intent: MediaToolCall) => {
  if (intent === "generate_image") return "Image";
  if (intent === "generate_video") return "Video";
  return "Audio";
};

const DIRECT_MEDIA_CREATION_PREFIX =
  /^(?:["'“”‘’]\s*)?(?:(?:please|kindly)\s+)?(?:create|generate|draw|paint|illustrate|render|produce|make|design)\b/i;

const IMAGE_OUTPUT_TERM =
  /\b(?:image|picture|photo|illustration|artwork|portrait|poster|logo|wallpaper|concept art|cover art)\b/i;

const VIDEO_OUTPUT_TERM = /\b(?:video|animation|movie|film|clip)\b/i;

const AUDIO_OUTPUT_TERM =
  /\b(?:audio|sound|voiceover|voice-over|speech|song|music|narration)\b/i;

const META_OUTPUT_TERM =
  /\b(?:prompt|table|list|api|sdk|component|code|guide|tutorial|comparison|react|vue|svelte|html|css|javascript|typescript|jsx|tsx)\b/i;

const IMAGE_META_COMPOUND =
  /\b(?:image|picture|photo|illustration|artwork|portrait|poster|logo|wallpaper|concept art|cover art)[-\s]+(?:(?:generat(?:ion|or|ing)|source)[-\s]+)?(?:prompt|gallery|models?|api|sdk|component|code|guide|tutorial)\b/i;

const DIRECT_REQUEST_RETRACTION =
  /\bbut\s+(?:(?:please|actually)\s+)?(?:do\s+not|don['’]?t|never)\b/i;

const firstMatchIndex = (text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  return match?.index ?? Number.POSITIVE_INFINITY;
};

const isDirectImageCreationRequest = (text: string) => {
  const normalized = normalizeValue(text).replace(/^\s*[-*]\s+/, "");
  const prefix = DIRECT_MEDIA_CREATION_PREFIX.exec(normalized);
  if (!prefix) return false;

  const leadingRequest = normalized
    .slice(prefix[0].length)
    .split(/\n|[.!?](?:\s|$)/, 1)[0]
    .slice(0, 512);
  if (/^\s*(?:no|not)\b/i.test(leadingRequest)) return false;
  if (DIRECT_REQUEST_RETRACTION.test(leadingRequest)) return false;

  const imageIndex = firstMatchIndex(leadingRequest, IMAGE_OUTPUT_TERM);
  if (!Number.isFinite(imageIndex)) return false;

  const competingOutputIndex = Math.min(
    firstMatchIndex(leadingRequest, VIDEO_OUTPUT_TERM),
    firstMatchIndex(leadingRequest, AUDIO_OUTPUT_TERM),
    firstMatchIndex(leadingRequest, META_OUTPUT_TERM)
  );
  if (competingOutputIndex < imageIndex) return false;

  const metaCompound = IMAGE_META_COMPOUND.exec(leadingRequest);
  return metaCompound?.index !== imageIndex;
};

export const resolveChatTurnIntent = (
  text: string,
  toolSettings: ToolAvailability,
  mode: ChatTurnIntent = "auto"
): ChatTurnIntentDecision => {
  if (mode === "auto") {
    if (isDirectImageCreationRequest(text)) {
      if (!toolSettings.image) {
        return {
          intent: "chat",
          source: "auto",
          reason: "Image generation is unavailable with the current tool settings.",
        };
      }
      return {
        intent: "generate_image",
        source: "auto",
        reason: "Detected a direct image creation request.",
      };
    }
    return {
      intent: "auto",
      source: "auto",
      reason:
        "The agent can choose available generation tools from the full conversation.",
    };
  }

  if (mode === "chat") {
    return {
      intent: "chat",
      source: "manual",
      reason: "Generation tools are disabled for this turn.",
    };
  }

  const label = mediaIntentLabel(mode);
  if (!mediaIntentAvailability(mode, toolSettings)) {
    return {
      intent: "chat",
      source: "manual",
      reason: `${label} generation is unavailable with the current tool settings.`,
    };
  }

  return {
    intent: mode,
    source: "manual",
    reason: `${label} generation is selected for this turn.`,
  };
};

export const resolveChatTurnToolPolicy = (
  decision: ChatTurnIntentDecision
): ChatTurnToolPolicy => {
  if (decision.intent === "auto") {
    return {
      activeTools: null,
      forcedToolCall: null,
      allowSyntheticFallback: false,
    };
  }
  if (decision.intent === "chat") {
    return {
      activeTools: [],
      forcedToolCall: null,
      allowSyntheticFallback: false,
    };
  }
  return {
    activeTools: [decision.intent],
    forcedToolCall: decision.intent,
    allowSyntheticFallback: true,
  };
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
