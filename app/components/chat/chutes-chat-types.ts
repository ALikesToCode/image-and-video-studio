import type { Dispatch, SetStateAction } from "react";

import type {
  ChatProvider,
  ModelOption,
  Provider,
} from "@/lib/constants";
import type {
  ChatAttachmentAsset,
  ChatImageAsset,
  ChatMediaAsset,
} from "@/lib/chat-media-persistence";
import type { ChatTurnIntent } from "@/lib/chat-turn-policy";
import type { AIChatToolCall } from "@/lib/ai-sdk-chat";
import type { ChatTokenUsage } from "@/lib/chat-metrics";
import type { NavyUsageResponse } from "@/lib/types";

export type ToolCall = AIChatToolCall;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  promptUsed?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  images?: ChatImageAsset[];
  media?: ChatMediaAsset[];
  attachments?: ChatAttachmentAsset[];
  turnIntent?: ChatTurnIntent;
  transient?: boolean;
  usage?: ChatTokenUsage;
};

export type QueuedChatTurn = {
  id: string;
  content: string;
  attachments: ChatAttachmentAsset[];
  turnIntent: ChatTurnIntent;
};

export type ChutesChatProps = {
  apiKey: string;
  allowServerApiKey?: boolean;
  provider: ChatProvider;
  setProvider: (value: ChatProvider) => void;
  models: ModelOption[];
  model: string;
  setModel: (value: string) => void;
  imageModels: ModelOption[];
  imageApiKeys?: Partial<Record<Provider, string>>;
  videoModels: ModelOption[];
  videoApiKeys?: Partial<Record<Provider, string>>;
  audioModels: ModelOption[];
  toolImageModel: string;
  setToolImageModel: (value: string) => void;
  imagePipelineEnabled: boolean;
  setImagePipelineEnabled: (value: boolean) => void;
  imageModelOrder: string[];
  setImageModelOrder: Dispatch<SetStateAction<string[]>>;
  imageRetryAttempts: number;
  setImageRetryAttempts: (value: number) => void;
  preferMaximumImageQuality: boolean;
  setPreferMaximumImageQuality: (enabled: boolean) => void;
  onRefreshModels?: () => void;
  modelsLoading?: boolean;
  modelsError?: string | null;
  navyUsage?: NavyUsageResponse | null;
  navyUsageError?: string | null;
  navyUsageLoading?: boolean;
  navyUsageUpdatedAt?: string | null;
  onRefreshUsage?: () => Promise<void> | void;
  saveToGallery?: boolean;
  videoImage?: string | null;
  videoAspect?: string;
  videoDuration?: string;
  ttsVoice?: string;
  ttsFormat?: string;
  ttsSpeed?: string;
  initialInput?: string | null;
  onSaveImages?: (payload: {
    images: ChatImageAsset[];
    prompt: string;
    model: string;
    provider: Provider;
  }) => Promise<void> | void;
};

export type ToolSettings = {
  image: boolean;
  video: boolean;
  audio: boolean;
};

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  image: true,
  video: true,
  audio: true,
};

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
];

export const MAX_CHAT_MESSAGES = 120;
export const MAX_CHAT_TOOL_ROUNDS = 1;
export const MAX_CHAT_MODEL_STEPS = MAX_CHAT_TOOL_ROUNDS + 1;
export const AUTO_SCROLL_BOTTOM_THRESHOLD = 80;
export const MAX_PENDING_ATTACHMENTS = 6;
export const CHAT_TEXT_ATTACHMENT_MAX_CHARS = 18_000;
export const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const CHAT_TURN_INTENTS: readonly ChatTurnIntent[] = [
  "auto",
  "chat",
  "generate_image",
  "generate_video",
  "generate_audio",
];

export const isChatTurnIntent = (value: unknown): value is ChatTurnIntent =>
  typeof value === "string" &&
  (CHAT_TURN_INTENTS as readonly string[]).includes(value);

export const chatTurnIntentLabel = (intent: ChatTurnIntent) => {
  if (intent === "auto") return "Auto · Agent decides";
  if (intent === "chat") return "Chat only";
  if (intent === "generate_image") return "Create image";
  if (intent === "generate_video") return "Create video";
  return "Create audio";
};

export const chatTurnIntentCompactLabel = (intent: ChatTurnIntent) => {
  if (intent === "auto") return "Auto";
  if (intent === "chat") return "Chat only";
  return chatTurnIntentLabel(intent);
};

export const isReasoningEffort = (
  value: unknown,
): value is ReasoningEffort =>
  value === "none" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh";
