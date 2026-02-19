/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Send,
  Trash2,
  Bot,
  User,
  Sparkles,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  BrainCircuit,
  Video,
  AudioLines,
  ToggleLeft,
  ToggleRight,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { type ModelOption, type ChatProvider } from "@/lib/constants";
import { dataUrlFromBase64, fetchAsDataUrl, cn } from "@/lib/utils";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "@/lib/chutes-prompts";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback } from "./ui/avatar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import {
  deleteStudioState,
  getStudioState,
  isStudioStateAvailable,
  putStudioState,
} from "@/lib/studio-state-db";

type ToolCall = {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  promptUsed?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  images?: { id: string; dataUrl: string; mimeType: string }[];
  media?: { id: string; kind: "image" | "video" | "audio"; dataUrl: string; mimeType: string }[];
};

type ChutesChatProps = {
  apiKey: string;
  provider: ChatProvider;
  setProvider: (value: ChatProvider) => void;
  models: ModelOption[];
  model: string;
  setModel: (value: string) => void;
  imageModels: ModelOption[];
  videoModels: ModelOption[];
  audioModels: ModelOption[];
  toolImageModel: string;
  setToolImageModel: (value: string) => void;
  onRefreshModels?: () => void;
  modelsLoading?: boolean;
  modelsError?: string | null;
  saveToGallery?: boolean;
  onSaveImages?: (payload: {
    images: { id: string; dataUrl: string; mimeType: string }[];
    prompt: string;
    model: string;
  }) => Promise<void> | void;
};

const NAVY_IMAGE_GUIDE_PROMPT = `# Prompt Guide for NavyAI Image Generation

Use concise, vivid descriptions with clear subjects, styles, and lighting. Ask for missing details.
Summarize the final prompt before generating, and prefer sizes like 1024x1024 unless specified.`;

const FLUX_CROSS_MODAL_GUIDE = `# Flux Cross-Modal Prompt Protocol

When generating image prompts for Flux models, optimize for downstream video and audio:

1. Keep one primary subject with stable identity details (face, outfit, props).
2. Use a cinematic frame with clear foreground, midground, and background.
3. Include an action-ready pose and a motion-friendly scene (good for later video animation).
4. Specify camera + lens + composition (shot type, angle, depth of field).
5. Specify lighting + color palette + atmosphere.
6. Include emotional tone so voice/audio style can match.
7. Add quality constraints: sharp focus, clean anatomy, clear silhouette, no text/logo/watermark.

Output format before tool call:
- Final Flux prompt
- Optional negative prompt
- One-line video readiness note
- One-line audio mood note`;

const getChatStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_history`;
const getSystemPromptStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_system_prompt`;
const getToolSettingsStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_tool_settings`;
const getToolVideoModelStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_tool_video_model`;
const getToolAudioModelStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_tool_audio_model`;
const MAX_CHAT_MESSAGES = 120;

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readLocalStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
};

const writeLocalStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

const extractTextFragment = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractTextFragment(item)).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractTextFragment(record.text) ||
      extractTextFragment(record.content) ||
      extractTextFragment(record.output_text) ||
      ""
    );
  }
  return "";
};

const extractReasoningFragment = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractReasoningFragment(item)).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractTextFragment(record.reasoning_text) ||
      extractTextFragment(record.reasoning) ||
      extractTextFragment(record.summary) ||
      extractTextFragment(record.text) ||
      ""
    );
  }
  return "";
};

const sanitizeChatMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const role = record.role;
      const content = typeof record.content === "string" ? record.content : "";
      if (!id) return null;
      if (role !== "user" && role !== "assistant" && role !== "tool") return null;

      const message: ChatMessage = { id, role, content };
      if (typeof record.thinking === "string") {
        message.thinking = record.thinking;
      }
      if (typeof record.promptUsed === "string") {
        message.promptUsed = record.promptUsed;
      }
      if (typeof record.toolCallId === "string") message.toolCallId = record.toolCallId;
      if (typeof record.name === "string") message.name = record.name;

      if (Array.isArray(record.toolCalls)) {
        const toolCalls = record.toolCalls
          .map((tc) => {
            if (!tc || typeof tc !== "object") return null;
            const tcRecord = tc as Record<string, unknown>;
            const tcId = typeof tcRecord.id === "string" ? tcRecord.id : "";
            const tcType = typeof tcRecord.type === "string" ? tcRecord.type : "function";
            const fn = tcRecord.function;
            if (!fn || typeof fn !== "object") return null;
            const fnRecord = fn as Record<string, unknown>;
            const fnName = typeof fnRecord.name === "string" ? fnRecord.name : "";
            const fnArgs = typeof fnRecord.arguments === "string" ? fnRecord.arguments : "";
            if (!tcId || !fnName) return null;
            return {
              id: tcId,
              type: tcType,
              function: {
                name: fnName,
                arguments: fnArgs,
              },
            };
          })
          .filter((entry): entry is ToolCall => !!entry);
        if (toolCalls.length) message.toolCalls = toolCalls;
      }

      if (Array.isArray(record.images)) {
        const images = record.images
          .map((img) => {
            if (!img || typeof img !== "object") return null;
            const imgRecord = img as Record<string, unknown>;
            const imgId = typeof imgRecord.id === "string" ? imgRecord.id : "";
            const dataUrl = typeof imgRecord.dataUrl === "string" ? imgRecord.dataUrl : "";
            const mimeType = typeof imgRecord.mimeType === "string" ? imgRecord.mimeType : "";
            if (!imgId || !dataUrl) return null;
            return { id: imgId, dataUrl, mimeType: mimeType || "image/png" };
          })
          .filter((entry): entry is { id: string; dataUrl: string; mimeType: string } => !!entry);
        if (images.length) message.images = images;
      }

      if (Array.isArray(record.media)) {
        const media = record.media
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const mediaRecord = item as Record<string, unknown>;
            const mediaId = typeof mediaRecord.id === "string" ? mediaRecord.id : "";
            const kind = mediaRecord.kind;
            const dataUrl = typeof mediaRecord.dataUrl === "string" ? mediaRecord.dataUrl : "";
            const mimeType = typeof mediaRecord.mimeType === "string" ? mediaRecord.mimeType : "";
            if (!mediaId || !dataUrl) return null;
            if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
            return {
              id: mediaId,
              kind,
              dataUrl,
              mimeType:
                mimeType ||
                (kind === "video"
                  ? "video/mp4"
                  : kind === "audio"
                    ? "audio/mpeg"
                    : "image/png"),
            };
          })
          .filter(
            (
              entry
            ): entry is {
              id: string;
              kind: "image" | "video" | "audio";
              dataUrl: string;
              mimeType: string;
            } => !!entry
          );
        if (media.length) message.media = media;
      } else if (message.images?.length) {
        message.media = message.images.map((image) => ({
          id: image.id,
          kind: "image" as const,
          dataUrl: image.dataUrl,
          mimeType: image.mimeType,
        }));
      }

      return message;
    })
    .filter((entry): entry is ChatMessage => !!entry)
    .slice(-MAX_CHAT_MESSAGES);
};

// Helper component for the thinking block
function ThinkingBlock({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="mb-3 rounded-xl bg-background/50 border border-border/50 overflow-hidden text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-muted-foreground/80 font-medium select-none"
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        <span>Thinking Process</span>
        <ChevronRight className={cn("h-3.5 w-3.5 ml-auto transition-transform", isExpanded && "rotate-90")} />
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="p-3 pt-0 font-mono text-muted-foreground/70 whitespace-pre-wrap leading-relaxed border-t border-border/30 border-dashed">
              {content.trim()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type ToolSettings = {
  image: boolean;
  video: boolean;
  audio: boolean;
};

const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  image: true,
  video: true,
  audio: true,
};

const sanitizeToolSettings = (value: unknown): ToolSettings => {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_TOOL_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  return {
    image: typeof record.image === "boolean" ? record.image : DEFAULT_TOOL_SETTINGS.image,
    video: typeof record.video === "boolean" ? record.video : DEFAULT_TOOL_SETTINGS.video,
    audio: typeof record.audio === "boolean" ? record.audio : DEFAULT_TOOL_SETTINGS.audio,
  };
};

export function ChutesChat({
  apiKey,
  provider,
  setProvider,
  models,
  model,
  setModel,
  imageModels,
  videoModels,
  audioModels,
  toolImageModel,
  setToolImageModel,
  onRefreshModels,
  modelsLoading,
  modelsError,
  saveToGallery = false,
  onSaveImages,
}: ChutesChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [systemPromptHydrated, setSystemPromptHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedPromptMessageId, setCopiedPromptMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const storageKey = useMemo(() => getChatStorageKey(provider), [provider]);
  const systemPromptStorageKey = useMemo(
    () => getSystemPromptStorageKey(provider),
    [provider]
  );
  const toolSettingsStorageKey = useMemo(
    () => getToolSettingsStorageKey(provider),
    [provider]
  );
  const toolVideoModelStorageKey = useMemo(
    () => getToolVideoModelStorageKey(provider),
    [provider]
  );
  const toolAudioModelStorageKey = useMemo(
    () => getToolAudioModelStorageKey(provider),
    [provider]
  );
  const providerLabel = provider === "navy" ? "NavyAI" : "Chutes";
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const [toolVideoModel, setToolVideoModel] = useState(
    videoModels[0]?.id ?? ""
  );
  const [toolAudioModel, setToolAudioModel] = useState(
    audioModels[0]?.id ?? ""
  );
  const [toolSettings, setToolSettings] = useState<ToolSettings>({
    ...DEFAULT_TOOL_SETTINGS,
  });
  const [toolSettingsHydrated, setToolSettingsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      if (typeof window === "undefined") return;
      let storedMessages: ChatMessage[] = [];

      if (isStudioStateAvailable()) {
        try {
          const fromDb = await getStudioState<ChatMessage[]>(storageKey);
          storedMessages = sanitizeChatMessages(fromDb);
        } catch {
          storedMessages = [];
        }
      }

      if (!storedMessages.length) {
        storedMessages = sanitizeChatMessages(
          readLocalStorage<ChatMessage[]>(storageKey, [])
        );
      }

      if (!cancelled) {
        setMessages(storedMessages);
      }
    };

    setMessages([]);
    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (messages.length <= MAX_CHAT_MESSAGES) return;
    setMessages((prev) => prev.slice(-MAX_CHAT_MESSAGES));
  }, [messages, storageKey]);

  useEffect(() => {
    let cancelled = false;
    const loadSystemPrompt = async () => {
      if (typeof window === "undefined") return;
      let storedPrompt = "";

      if (isStudioStateAvailable()) {
        try {
          const fromDb = await getStudioState<string>(systemPromptStorageKey);
          if (typeof fromDb === "string") {
            storedPrompt = fromDb;
          }
        } catch {
          storedPrompt = "";
        }
      }

      if (!storedPrompt) {
        const fromStorage = readLocalStorage<string>(systemPromptStorageKey, "");
        if (typeof fromStorage === "string") {
          storedPrompt = fromStorage;
        }
      }

      if (!cancelled) {
        setCustomSystemPrompt(storedPrompt);
        setSystemPromptHydrated(true);
      }
    };

    setSystemPromptHydrated(false);
    setCustomSystemPrompt("");
    void loadSystemPrompt();
    return () => {
      cancelled = true;
    };
  }, [systemPromptStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!systemPromptHydrated) return;
    const persist = async () => {
      const hasValue = customSystemPrompt.trim().length > 0;

      if (isStudioStateAvailable()) {
        try {
          if (hasValue) {
            await putStudioState(systemPromptStorageKey, customSystemPrompt);
          } else {
            await deleteStudioState(systemPromptStorageKey);
          }
        } catch {
          // fall through to localStorage
        }
      }

      try {
        if (hasValue) {
          writeLocalStorage(
            systemPromptStorageKey,
            JSON.stringify(customSystemPrompt)
          );
        } else {
          window.localStorage.removeItem(systemPromptStorageKey);
        }
      } catch {
        // ignore storage failures
      }
    };

    const handle = window.setTimeout(() => {
      void persist();
    }, 300);

    return () => window.clearTimeout(handle);
  }, [customSystemPrompt, systemPromptStorageKey, systemPromptHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextToolSettings = sanitizeToolSettings(
      readLocalStorage<unknown>(toolSettingsStorageKey, DEFAULT_TOOL_SETTINGS)
    );
    const storedToolVideoModel = readLocalStorage<string>(
      toolVideoModelStorageKey,
      ""
    );
    const storedToolAudioModel = readLocalStorage<string>(
      toolAudioModelStorageKey,
      ""
    );

    const fallbackVideoModel = videoModels[0]?.id ?? "";
    const fallbackAudioModel = audioModels[0]?.id ?? "";
    const hasStoredVideoModel = videoModels.some(
      (entry) => entry.id === storedToolVideoModel
    );
    const hasStoredAudioModel = audioModels.some(
      (entry) => entry.id === storedToolAudioModel
    );

    setToolSettings(nextToolSettings);
    setToolVideoModel(hasStoredVideoModel ? storedToolVideoModel : fallbackVideoModel);
    setToolAudioModel(hasStoredAudioModel ? storedToolAudioModel : fallbackAudioModel);
    setToolSettingsHydrated(true);
  }, [
    provider,
    toolSettingsStorageKey,
    toolVideoModelStorageKey,
    toolAudioModelStorageKey,
    videoModels,
    audioModels,
  ]);

  useEffect(() => {
    if (!videoModels.length) return;
    if (!videoModels.some((entry) => entry.id === toolVideoModel)) {
      setToolVideoModel(videoModels[0].id);
    }
  }, [videoModels, toolVideoModel]);

  useEffect(() => {
    if (!audioModels.length) return;
    if (!audioModels.some((entry) => entry.id === toolAudioModel)) {
      setToolAudioModel(audioModels[0].id);
    }
  }, [audioModels, toolAudioModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!toolSettingsHydrated) return;
    writeLocalStorage(toolSettingsStorageKey, JSON.stringify(toolSettings));
  }, [toolSettings, toolSettingsStorageKey, toolSettingsHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!toolSettingsHydrated) return;
    if (toolVideoModel) {
      writeLocalStorage(toolVideoModelStorageKey, JSON.stringify(toolVideoModel));
    } else {
      window.localStorage.removeItem(toolVideoModelStorageKey);
    }
  }, [toolVideoModel, toolVideoModelStorageKey, toolSettingsHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!toolSettingsHydrated) return;
    if (toolAudioModel) {
      writeLocalStorage(toolAudioModelStorageKey, JSON.stringify(toolAudioModel));
    } else {
      window.localStorage.removeItem(toolAudioModelStorageKey);
    }
  }, [toolAudioModel, toolAudioModelStorageKey, toolSettingsHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = messages.slice(-MAX_CHAT_MESSAGES);
    const persist = async () => {
      if (isStudioStateAvailable()) {
        try {
          await putStudioState(storageKey, trimmed);
          return;
        } catch {
          // fall through to localStorage
        }
      }
      try {
        writeLocalStorage(storageKey, JSON.stringify(trimmed));
      } catch {
        // ignore storage failures
      }
    };

    const handle = window.setTimeout(() => {
      void persist();
    }, 300);

    return () => window.clearTimeout(handle);
  }, [messages, storageKey]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const toolSpec = useMemo(() => {
    const specs: Array<Record<string, unknown>> = [];

    if (toolSettings.image) {
      specs.push(
        provider === "navy"
          ? {
              type: "function",
              function: {
                name: "generate_image",
                description:
                  "Generate an image. Use the default model unless the user asks for a specific one.",
                parameters: {
                  type: "object",
                  properties: {
                    prompt: { type: "string", description: "Image description." },
                    model: { type: "string", description: "Image model id." },
                    size: {
                      type: "string",
                      description: "Image size like 1024x1024.",
                    },
                    quality: {
                      type: "string",
                      description: "DALL-E 3 quality: standard or hd.",
                    },
                    style: {
                      type: "string",
                      description: "DALL-E 3 style: vivid or natural.",
                    },
                    n: {
                      type: "integer",
                      description: "Number of images to generate.",
                    },
                  },
                  required: ["prompt"],
                },
              },
            }
          : {
              type: "function",
              function: {
                name: "generate_image",
                description:
                  "Generate an image. Use the default model unless the user asks for a specific one.",
                parameters: {
                  type: "object",
                  properties: {
                    prompt: { type: "string", description: "Image description." },
                    model: { type: "string", description: "Image model id." },
                    negative_prompt: {
                      type: "string",
                      description: "What to avoid in the image.",
                    },
                    guidance_scale: { type: "number", description: "CFG guidance." },
                    width: { type: "number", description: "Width in pixels." },
                    height: { type: "number", description: "Height in pixels." },
                    resolution: {
                      type: "string",
                      description: "Resolution like 1024x1024 (HiDream).",
                    },
                    num_inference_steps: {
                      type: "number",
                      description: "Diffusion steps.",
                    },
                    seed: { type: "integer", description: "Seed (optional)." },
                  },
                  required: ["prompt"],
                },
              },
            }
      );
    }

    if (toolSettings.video) {
      specs.push(
        provider === "navy"
          ? {
              type: "function",
              function: {
                name: "generate_video",
                description:
                  "Generate a short video. Use the default video model unless the user asks for a specific one.",
                parameters: {
                  type: "object",
                  properties: {
                    prompt: { type: "string", description: "Video description." },
                    model: { type: "string", description: "Video model id." },
                    size: {
                      type: "string",
                      description: "Output size or aspect ratio such as 16:9.",
                    },
                    seconds: {
                      type: "number",
                      description: "Video duration in seconds (if supported).",
                    },
                    image_url: {
                      type: "string",
                      description:
                        "Optional start frame as URL or data URI when supported.",
                    },
                    seed: {
                      type: "integer",
                      description: "Optional seed for reproducibility.",
                    },
                  },
                  required: ["prompt"],
                },
              },
            }
          : {
              type: "function",
              function: {
                name: "generate_video",
                description:
                  "Generate a video from an input image using Chutes i2v. Requires an image URL or data URI.",
                parameters: {
                  type: "object",
                  properties: {
                    prompt: { type: "string", description: "Video description." },
                    model: { type: "string", description: "Video model id." },
                    image: {
                      type: "string",
                      description:
                        "Source image as URL or data URI. Required for Chutes video.",
                    },
                    fps: {
                      type: "number",
                      description: "Frames per second.",
                    },
                    guidance_scale_2: {
                      type: "number",
                      description: "Secondary guidance scale.",
                    },
                  },
                  required: ["prompt", "image"],
                },
              },
            }
      );
    }

    if (toolSettings.audio) {
      specs.push(
        provider === "navy"
          ? {
              type: "function",
              function: {
                name: "generate_audio",
                description:
                  "Generate speech audio from text. Use the default TTS model unless the user asks for a specific one.",
                parameters: {
                  type: "object",
                  properties: {
                    input: { type: "string", description: "Text to synthesize." },
                    model: { type: "string", description: "TTS model id." },
                    voice: { type: "string", description: "Voice preset." },
                    speed: { type: "number", description: "Playback speed." },
                    response_format: {
                      type: "string",
                      description: "Audio format: mp3, opus, aac, flac.",
                    },
                  },
                  required: ["input"],
                },
              },
            }
          : {
              type: "function",
              function: {
                name: "generate_audio",
                description:
                  "Generate speech audio from text with Chutes voice models.",
                parameters: {
                  type: "object",
                  properties: {
                    text: { type: "string", description: "Text to synthesize." },
                    model: { type: "string", description: "Audio model id." },
                    speed: { type: "number", description: "Playback speed." },
                    speaker: { type: "integer", description: "Speaker id (CSM-1B)." },
                    max_duration_ms: {
                      type: "integer",
                      description: "Maximum duration in milliseconds (CSM-1B).",
                    },
                  },
                  required: ["text"],
                },
              },
            }
      );
    }

    return specs;
  }, [provider, toolSettings]);

  const systemPrompt = useMemo(() => {
    const modelList = imageModels.map((item) => item.id).join(", ");
    const videoModelList = videoModels.map((item) => item.id).join(", ");
    const audioModelList = audioModels.map((item) => item.id).join(", ");
    const fluxModelActive = /flux/i.test(toolImageModel);
    const promptGuide =
      provider === "navy" ? NAVY_IMAGE_GUIDE_PROMPT : CHUTES_IMAGE_GUIDE_PROMPT;
    const enabledToolLines: string[] = [];
    if (toolSettings.image) {
      enabledToolLines.push(
        `- generate_image (default model: ${toolImageModel}; available image models: ${modelList})`
      );
    }
    if (toolSettings.video) {
      enabledToolLines.push(
        `- generate_video (default model: ${toolVideoModel}; available video models: ${videoModelList})`
      );
    }
    if (toolSettings.audio) {
      enabledToolLines.push(
        `- generate_audio (default model: ${toolAudioModel}; available audio models: ${audioModelList})`
      );
    }
    const toolInstruction = enabledToolLines.length
      ? `You can call these tools when appropriate:\n${enabledToolLines.join("\n")}`
      : "No tools are enabled right now. Help the user with planning/prompts only.";

    const providerHint =
      provider === "chutes"
        ? "For Chutes video generation, always ensure an image input is provided before calling generate_video."
        : "For Navy video generation, use generate_video for short clips and keep durations reasonable.";

    const crossModalHint =
      "When image generation is requested, optimize prompts so the output can also be used as a strong keyframe for video and as artwork aligned with narration/voice mood.";

    const fluxHint = fluxModelActive
      ? `Flux mode is active (default image model: ${toolImageModel}). Strictly follow the Flux Cross-Modal Prompt Protocol below.`
      : "If the user asks for Flux or selects a Flux model, switch into Flux Cross-Modal Prompt Protocol.";

    const defaultPrompt = `${promptGuide}
${FLUX_CROSS_MODAL_GUIDE}

You are a generation assistant. Help craft prompts, ask for missing details when needed, and summarize the final prompt before calling a generation tool.
${crossModalHint}
${fluxHint}
If the user explicitly asks to generate now, you must call the relevant tool in the same turn (do not stop at prompt drafting only).
${providerHint}
${toolInstruction}`;
    const customPrompt = customSystemPrompt.trim();
    if (!customPrompt) return defaultPrompt;
    return `${customPrompt}

${defaultPrompt}`;
  }, [
    toolImageModel,
    toolVideoModel,
    toolAudioModel,
    imageModels,
    videoModels,
    audioModels,
    toolSettings,
    provider,
    customSystemPrompt,
  ]);

  const toApiMessages = (items: ChatMessage[]) =>
    items.map((message) => {
      const base: Record<string, unknown> = {
        role: message.role,
        content: message.content,
      };
      if (message.role === "assistant" && message.toolCalls?.length) {
        base.tool_calls = message.toolCalls;
      }
      if (message.role === "tool") {
        base.tool_call_id = message.toolCallId;
        if (message.name) base.name = message.name;
      }
      return base;
    });



  const callChatStreaming = async (
    items: ChatMessage[],
    onUpdate: (update: { content?: string; thinking?: string; toolCalls?: ToolCall[] }) => void,
    toolChoiceOverride?: unknown
  ) => {
    const endpoint = provider === "navy" ? "/api/navy/chat" : "/api/chutes/chat";
    const hasEnabledTools = toolSpec.length > 0;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...toApiMessages(items),
        ],
        ...(
          hasEnabledTools
            ? {
                tools: toolSpec,
                toolChoice: toolChoiceOverride ?? "auto",
              }
            : { toolChoice: "none" }
        ),
        maxTokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.error ?? "Chat request failed.");
    }

    if (!response.body) {
      throw new Error("No response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Accumulators
    let contentAcc = "";
    let thinkingAcc = "";
    const toolCallsMap = new Map<
      number,
      { id?: string; type?: string; name?: string; args: string }
    >();
    const buildToolCallsForUpdates = () =>
      Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([index, tc]) => ({
          id: tc.id || `pending-tool-${index}`,
          type: tc.type || "function",
          function: {
            name: tc.name || "",
            arguments: tc.args || "",
          },
        }))
        .filter((tc) => tc.function.name);
    const buildExecutableToolCalls = () =>
      Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id || "",
          type: tc.type || "function",
          function: {
            name: tc.name || "",
            arguments: tc.args || "",
          },
        }))
        .filter((tc) => tc.function.name && tc.id);

    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === "[DONE]") return;
        try {
          const json = JSON.parse(event.data);
          const choice = json.choices?.[0];
          if (!choice) return;

          const delta =
            choice.delta && typeof choice.delta === "object"
              ? (choice.delta as Record<string, unknown>)
              : {};

          const deltaContent = extractTextFragment(delta.content);
          if (deltaContent) {
            contentAcc += deltaContent;
            onUpdate({ content: contentAcc });
          }

          const reasoningText =
            extractReasoningFragment(delta.reasoning_content) ||
            extractReasoningFragment(delta.reasoning);
          if (reasoningText) {
            thinkingAcc += reasoningText;
            onUpdate({ thinking: thinkingAcc });
          }

          const rawToolCalls = Array.isArray(delta.tool_calls)
            ? delta.tool_calls
            : [];
          if (rawToolCalls.length) {
            for (const tc of rawToolCalls) {
              if (!tc || typeof tc !== "object") continue;
              const toolRecord = tc as Record<string, unknown>;
              const fn =
                toolRecord.function && typeof toolRecord.function === "object"
                  ? (toolRecord.function as Record<string, unknown>)
                  : {};
              const index =
                typeof toolRecord.index === "number" ? toolRecord.index : 0;
              if (!toolCallsMap.has(index)) {
                toolCallsMap.set(index, { args: "" });
              }
              const current = toolCallsMap.get(index);
              if (!current) continue;

              if (typeof toolRecord.id === "string" && toolRecord.id) {
                current.id = toolRecord.id;
              }
              if (typeof toolRecord.type === "string" && toolRecord.type) {
                current.type = toolRecord.type;
              }
              if (typeof fn.name === "string" && fn.name) {
                current.name = fn.name;
              }
              if (typeof fn.arguments === "string" && fn.arguments) {
                current.args += fn.arguments;
              }
            }
            const toolCalls = buildToolCallsForUpdates();

            if (toolCalls.length > 0) {
              onUpdate({ toolCalls });
            }
          }
        } catch (e) {
          console.error("Parse error", e);
        }
      }
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.feed(decoder.decode());
    } finally {
      reader.releaseLock();
    }

    // Final result return could be useful, but state is updated via callback
    return {
      content: contentAcc,
      thinking: thinkingAcc,
      toolCalls: buildExecutableToolCalls(),
    };
  };

  const getStringArg = (args: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.trim().length) {
        return value.trim();
      }
    }
    return "";
  };

  const getNumberArg = (args: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim().length) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  };

  const blobToDataUrl = async (blob: Blob) =>
    await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Unable to read media output."));
      reader.readAsDataURL(blob);
    });

  const runGenerateImage = async (args: Record<string, unknown>) => {
    if (!apiKey.trim()) {
      throw new Error("Missing API key for image tool.");
    }
    const prompt = getStringArg(args, ["prompt"]);
    if (!prompt) {
      throw new Error("Tool call missing prompt.");
    }
    const modelOverride = getStringArg(args, ["model"]) || toolImageModel;
    const endpoint = provider === "navy" ? "/api/navy/image" : "/api/chutes/image";
    const body: Record<string, unknown> = {
      apiKey,
      model: modelOverride,
      prompt,
    };
    if (provider === "navy") {
      const numberOfImages = getNumberArg(args, ["n"]);
      const size = getStringArg(args, ["size"]);
      const quality = getStringArg(args, ["quality"]);
      const style = getStringArg(args, ["style"]);
      if (size) body.size = size;
      if (quality) body.quality = quality;
      if (style) body.style = style;
      if (numberOfImages && numberOfImages > 0) {
        body.numberOfImages = Math.max(1, Math.round(numberOfImages));
      }
    } else {
      const guidanceScale = getNumberArg(args, ["guidance_scale"]);
      const width = getNumberArg(args, ["width"]);
      const height = getNumberArg(args, ["height"]);
      const steps = getNumberArg(args, ["num_inference_steps"]);
      const seed = getNumberArg(args, ["seed"]);
      const negativePrompt = getStringArg(args, ["negative_prompt"]);
      const resolution = getStringArg(args, ["resolution"]);
      body.negativePrompt = negativePrompt || undefined;
      body.guidanceScale = guidanceScale ?? undefined;
      body.width = width ? Math.round(width) : undefined;
      body.height = height ? Math.round(height) : undefined;
      body.resolution = resolution || undefined;
      body.numInferenceSteps = steps ? Math.round(steps) : undefined;
      body.seed = seed !== null ? Math.round(seed) : null;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error ?? "Image tool failed.");
    }
    const images = Array.isArray(payload?.images)
      ? (payload.images as Array<{ data?: unknown; mimeType?: unknown; url?: unknown }>)
      : [];
    if (!images.length) {
      throw new Error("No images returned by tool.");
    }
    const parsedImages = (
      await Promise.all(
        images.map(async (image) => {
          const data = typeof image?.data === "string" ? image.data : "";
          const mimeType =
            typeof image?.mimeType === "string" ? image.mimeType : "image/png";
          if (data) {
            return {
              id: createId(),
              dataUrl: dataUrlFromBase64(data, mimeType),
              mimeType,
            };
          }
          if (typeof image?.url === "string") {
            const dataUrl = await fetchAsDataUrl(image.url);
            return {
              id: createId(),
              dataUrl,
              mimeType,
            };
          }
          return null;
        })
      )
    ).filter(
      (item): item is { id: string; dataUrl: string; mimeType: string } => !!item
    );
    if (!parsedImages.length) {
      throw new Error("No usable images returned by tool.");
    }
    return { images: parsedImages, model: modelOverride, prompt };
  };

  const runGenerateVideo = async (args: Record<string, unknown>) => {
    if (!apiKey.trim()) {
      throw new Error("Missing API key for video tool.");
    }
    const prompt = getStringArg(args, ["prompt"]);
    if (!prompt) {
      throw new Error("Tool call missing prompt.");
    }
    const modelOverride = getStringArg(args, ["model"]) || toolVideoModel;

    if (provider === "navy") {
      const size = getStringArg(args, ["size"]);
      const imageUrl = getStringArg(args, ["image_url", "image"]);
      const seconds = getNumberArg(args, ["seconds"]);
      const seed = getNumberArg(args, ["seed"]);
      const createResponse = await fetch("/api/navy/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model: modelOverride,
          prompt,
          size: size || undefined,
          imageUrl: imageUrl || undefined,
          seconds: seconds ?? undefined,
          seed: seed ?? undefined,
        }),
      });
      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createPayload?.error ?? "Unable to start video generation.");
      }

      const jobId =
        typeof createPayload?.id === "string" ? createPayload.id : "";
      if (!jobId) {
        throw new Error("No video job id returned by provider.");
      }

      let videoUrl = "";
      const maxAttempts = 120;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const pollResponse = await fetch(
          `/api/navy/video?id=${encodeURIComponent(jobId)}`,
          {
            headers: {
              "x-user-api-key": apiKey,
            },
          }
        );
        const pollPayload = await pollResponse.json();
        if (!pollResponse.ok) {
          throw new Error(
            pollPayload?.error ?? "Unable to check video generation status."
          );
        }
        if (!pollPayload?.done) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        if (typeof pollPayload?.error === "string" && pollPayload.error.length) {
          throw new Error(pollPayload.error);
        }
        if (typeof pollPayload?.videoUrl === "string" && pollPayload.videoUrl.length) {
          videoUrl = pollPayload.videoUrl;
          break;
        }
      }
      if (!videoUrl) {
        throw new Error("Video generation timed out before a result was available.");
      }
      let resolvedVideoUrl = videoUrl;
      let resolvedMimeType = "video/mp4";
      const downloadResponse = await fetch("/api/navy/video/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": apiKey,
        },
        body: JSON.stringify({ url: videoUrl }),
      });
      if (downloadResponse.ok) {
        const blob = await downloadResponse.blob();
        resolvedMimeType = blob.type || "video/mp4";
        resolvedVideoUrl = await blobToDataUrl(blob);
      }
      return {
        media: [
          {
            id: createId(),
            kind: "video" as const,
            dataUrl: resolvedVideoUrl,
            mimeType: resolvedMimeType,
          },
        ],
        model: modelOverride,
        prompt,
      };
    }

    const sourceImage = getStringArg(args, ["image", "image_url"]);
    if (!sourceImage) {
      throw new Error("Chutes video generation requires an image URL or data URI.");
    }
    const fps = getNumberArg(args, ["fps"]);
    const guidanceScale = getNumberArg(args, ["guidance_scale_2"]);
    const response = await fetch("/api/chutes/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        prompt,
        model: modelOverride,
        image: sourceImage,
        fps: fps ?? undefined,
        guidance_scale_2: guidanceScale ?? undefined,
      }),
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        throw new Error(payload?.error ?? "Video tool failed.");
      }
      const message = await response.text();
      throw new Error(message || "Video tool failed.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (typeof payload?.error === "string" && payload.error.length) {
        throw new Error(payload.error);
      }
      if (typeof payload?.url === "string" && payload.url.length) {
        return {
          media: [
            {
              id: createId(),
              kind: "video" as const,
              dataUrl: payload.url,
              mimeType: "video/mp4",
            },
          ],
          model: modelOverride,
          prompt,
        };
      }
      if (typeof payload?.data === "string" && payload.data.length) {
        const mimeType =
          typeof payload?.mimeType === "string"
            ? payload.mimeType
            : "video/mp4";
        return {
          media: [
            {
              id: createId(),
              kind: "video" as const,
              dataUrl: dataUrlFromBase64(payload.data, mimeType),
              mimeType,
            },
          ],
          model: modelOverride,
          prompt,
        };
      }
      throw new Error("No usable video output returned by tool.");
    }

    const blob = await response.blob();
    const mimeType = blob.type || "video/mp4";
    return {
      media: [
        {
          id: createId(),
          kind: "video" as const,
          dataUrl: await blobToDataUrl(blob),
          mimeType,
        },
      ],
      model: modelOverride,
      prompt,
    };
  };

  const runGenerateAudio = async (args: Record<string, unknown>) => {
    if (!apiKey.trim()) {
      throw new Error("Missing API key for audio tool.");
    }
    const prompt = getStringArg(args, ["input", "text", "prompt"]);
    if (!prompt) {
      throw new Error("Tool call missing input text.");
    }
    const modelOverride = getStringArg(args, ["model"]) || toolAudioModel;

    if (provider === "navy") {
      const speed = getNumberArg(args, ["speed"]);
      const voice = getStringArg(args, ["voice"]) || "alloy";
      const responseFormat = getStringArg(args, ["response_format"]);
      const response = await fetch("/api/navy/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model: modelOverride,
          input: prompt,
          voice,
          speed: speed ?? undefined,
          responseFormat: responseFormat || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Audio tool failed.");
      }
      const audioData = payload?.audio?.data;
      const mimeType =
        typeof payload?.audio?.mimeType === "string"
          ? payload.audio.mimeType
          : "audio/mpeg";
      if (typeof audioData !== "string" || !audioData.length) {
        throw new Error("No audio data returned by tool.");
      }
      return {
        media: [
          {
            id: createId(),
            kind: "audio" as const,
            dataUrl: dataUrlFromBase64(audioData, mimeType),
            mimeType,
          },
        ],
        model: modelOverride,
        prompt,
      };
    }

    const speed = getNumberArg(args, ["speed"]);
    const speaker = getNumberArg(args, ["speaker"]);
    const maxDuration = getNumberArg(args, ["max_duration_ms", "maxDuration"]);
    const response = await fetch("/api/chutes/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        prompt,
        model: modelOverride,
        speed: speed ?? undefined,
        speaker: speaker ?? undefined,
        maxDuration: maxDuration ?? undefined,
      }),
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        throw new Error(payload?.error ?? "Audio tool failed.");
      }
      const message = await response.text();
      throw new Error(message || "Audio tool failed.");
    }
    const blob = await response.blob();
    const mimeType = blob.type || "audio/mpeg";
    return {
      media: [
        {
          id: createId(),
          kind: "audio" as const,
          dataUrl: await blobToDataUrl(blob),
          mimeType,
        },
      ],
      model: modelOverride,
      prompt,
    };
  };

  const parseToolArgs = (rawArgs: string) => {
    if (!rawArgs) return {};
    const parsed = JSON.parse(rawArgs);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid tool arguments.");
    }
    return parsed as Record<string, unknown>;
  };

  const copyPromptText = async (messageId: string, promptText: string) => {
    if (!promptText.trim()) return;
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPromptMessageId(messageId);
      window.setTimeout(
        () => setCopiedPromptMessageId((prev) => (prev === messageId ? null : prev)),
        1500
      );
    } catch {
      // ignore clipboard failures
    }
  };

  const handleToolCalls = async (
    toolCalls: ToolCall[],
    onProgress?: (message: ChatMessage) => void
  ) => {
    const toolMessages: ChatMessage[] = [];
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name ?? "";
      let args: Record<string, unknown> = {};

      try {
        args = parseToolArgs(toolCall.function?.arguments ?? "");
      } catch {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: "Tool error: Invalid tool arguments.",
          toolCallId: toolCall.id,
          name: toolName || undefined,
        });
        continue;
      }

      const invocationPrompt = getStringArg(args, ["prompt", "input", "text"]);

      const disabledByUser =
        (toolName === "generate_image" && !toolSettings.image) ||
        (toolName === "generate_video" && !toolSettings.video) ||
        (toolName === "generate_audio" && !toolSettings.audio);
      if (disabledByUser) {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: `Tool error: ${toolName} is currently disabled.`,
          promptUsed: invocationPrompt || undefined,
          toolCallId: toolCall.id,
          name: toolName || undefined,
        });
        continue;
      }

      try {
        if (toolName) {
          onProgress?.({
            id: createId(),
            role: "tool",
            content: `Invoking ${toolName}...`,
            promptUsed: invocationPrompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
          });
        }

        if (toolName === "generate_image") {
          const result = await runGenerateImage(args);
          if (saveToGallery && onSaveImages) {
            await onSaveImages({
              images: result.images,
              prompt: result.prompt,
              model: result.model,
            });
          }
          toolMessages.push({
            id: createId(),
            role: "tool",
            content: `Generated ${result.images.length} image(s) using ${result.model}.`,
            promptUsed: result.prompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            images: result.images,
            media: result.images.map((image) => ({
              ...image,
              kind: "image" as const,
            })),
          });
          continue;
        }

        if (toolName === "generate_video") {
          const result = await runGenerateVideo(args);
          toolMessages.push({
            id: createId(),
            role: "tool",
            content: `Video generated using ${result.model}.`,
            promptUsed: result.prompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            media: result.media,
          });
          continue;
        }

        if (toolName === "generate_audio") {
          const result = await runGenerateAudio(args);
          toolMessages.push({
            id: createId(),
            role: "tool",
            content: `Audio generated using ${result.model}.`,
            promptUsed: result.prompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            media: result.media,
          });
          continue;
        }

        toolMessages.push({
          id: createId(),
          role: "tool",
          content: "Tool error: Unknown tool call.",
          promptUsed: invocationPrompt || undefined,
          toolCallId: toolCall.id,
          name: toolName || undefined,
        });
      } catch (error) {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: `Tool error: ${error instanceof Error ? error.message : "Tool failed."}`,
          promptUsed: invocationPrompt || undefined,
          toolCallId: toolCall.id,
          name: toolName || undefined,
        });
      }
    }
    return toolMessages;
  };

  const detectForcedToolCall = (
    text: string
  ): "generate_image" | "generate_video" | "generate_audio" | null => {
    const normalized = text.toLowerCase();
    const explicitGenerate =
      /\b(generate|create|make|render|produce|draw)\b/.test(normalized) ||
      /\bnow\b/.test(normalized);
    if (!explicitGenerate) return null;

    const videoIntent = /\b(video|clip|animate|animation|movie)\b/.test(normalized);
    const audioIntent = /\b(audio|voice|speech|tts|narration)\b/.test(normalized);
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

  const extractImagePromptForFallback = (assistantContent: string, userPrompt: string) => {
    const patterns = [
      /final flux prompt:\s*([\s\S]*?)(?:\nnegative prompt:|\nvideo readiness:|\naudio mood:|\n\s*\n|$)/i,
      /final prompt:\s*([\s\S]*?)(?:\nnegative prompt:|\nvideo readiness:|\naudio mood:|\n\s*\n|$)/i,
      /prompt:\s*([\s\S]*?)(?:\nnegative prompt:|\nvideo readiness:|\naudio mood:|\n\s*\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = assistantContent.match(pattern);
      if (!match || !match[1]) continue;
      const candidate = match[1]
        .replace(/^\s*[-*]\s*/gm, "")
        .replace(/^["']|["']$/g, "")
        .trim();
      if (candidate.length > 8) return candidate;
    }
    return userPrompt;
  };

  const submitMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (!apiKey.trim()) {
      setChatError(`Add your ${providerLabel} API key in settings.`);
      return;
    }
    if (!model) {
      setChatError("Select a chat model.");
      return;
    }
    setChatError(null);
    setInput("");

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };

    // Optimistic update
    let currentMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(currentMessages);
    setBusy(true);
    const forcedToolCall = detectForcedToolCall(trimmed);

    try {
      for (let step = 0; step < 3; step += 1) {
        // Create placeholder assistant message
        const assistantId = createId();
        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
        };

        // Add to state immediately
        currentMessages = [...currentMessages, assistantMessage];
        setMessages(currentMessages);

        // Stream content into this message
        const finalResult = await callChatStreaming(
          currentMessages.slice(0, -1), // Send history excluding the placeholder
          (update) => {
            setMessages((prev) => prev.map((msg) => {
              if (msg.id === assistantId) {
                return {
                  ...msg,
                  content: update.content ?? msg.content,
                  thinking: update.thinking ?? msg.thinking,
                  toolCalls: update.toolCalls ?? msg.toolCalls,
                };
              }
              return msg;
            }));
          },
          step === 0 && forcedToolCall
            ? { type: "function", function: { name: forcedToolCall } }
            : undefined
        );

        // After stream is done, final update to ensure consistency (and clean up any missing fields)
        const finalToolCalls = finalResult.toolCalls.filter(tc => tc.id && tc.function.name);

        // Update the message in our local variable to be current
        const finalizedAssistantMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: finalResult.content,
          thinking: finalResult.thinking || undefined,
          toolCalls: finalToolCalls.length ? finalToolCalls : undefined
        };

        // Replace the placeholder in currentMessages with the finalized one
        currentMessages = [...currentMessages.slice(0, -1), finalizedAssistantMessage];
        setMessages(currentMessages);

        // Check for tool calls
        if (!finalToolCalls.length) {
          // Fallback: if image generation was explicitly requested but model did not emit a tool call,
          // run one using the drafted prompt so generation still happens.
          if (step === 0 && forcedToolCall === "generate_image" && toolSettings.image) {
            const fallbackPrompt = extractImagePromptForFallback(
              finalResult.content,
              trimmed
            );
            const syntheticToolCall: ToolCall = {
              id: createId(),
              type: "function",
              function: {
                name: "generate_image",
                arguments: JSON.stringify({
                  prompt: fallbackPrompt,
                  model: toolImageModel,
                }),
              },
            };
            const toolMessages = await handleToolCalls(
              [syntheticToolCall],
              (progressMessage) => {
                currentMessages = [...currentMessages, progressMessage];
                setMessages(currentMessages);
              }
            );
            if (toolMessages.length) {
              currentMessages = [...currentMessages, ...toolMessages];
              setMessages(currentMessages);
            }
          }
          break;
        }

        // Run tools
        const toolMessages = await handleToolCalls(finalToolCalls, (progressMessage) => {
          currentMessages = [...currentMessages, progressMessage];
          setMessages(currentMessages);
        });
        currentMessages = [...currentMessages, ...toolMessages];
        setMessages(currentMessages);
      }
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Unable to run chat."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setChatError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
    if (isStudioStateAvailable()) {
      void deleteStudioState(storageKey);
    }
  };

  const clearSystemPrompt = () => {
    setCustomSystemPrompt("");
  };

  return (
    <div className="flex flex-col h-full bg-background/50 isolate">
      {/* Header */}
      <header className="flex-none p-4 glass border-b sticky top-0 z-10">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-center max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-2 rounded-xl bg-primary/10 text-primary"
            >
              <Bot className="h-6 w-6" />
            </motion.div>
            <div>
              <h2 className="font-semibold text-lg leading-none">
                {provider === "navy" ? "NavyAI Chat" : "Chutes Agent"}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Online
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={provider} onValueChange={(value) => setProvider(value as ChatProvider)}>
              <SelectTrigger className="w-full sm:w-[140px] h-9 glass-card border-0 bg-secondary/50">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chutes">Chutes</SelectItem>
                <SelectItem value="navy">NavyAI</SelectItem>
              </SelectContent>
            </Select>

            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-full sm:w-[200px] h-9 glass-card border-0 bg-secondary/50">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={toolImageModel}
              onValueChange={setToolImageModel}
              disabled={!toolSettings.image || !imageModels.length}
            >
              <SelectTrigger className="w-full sm:w-[40px] px-0 justify-center h-9 glass-card border-0 bg-secondary/50" title="Image Tool Model">
                <ImageIcon className="h-4 w-4" />
              </SelectTrigger>
              <SelectContent>
                {imageModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={toolVideoModel}
              onValueChange={setToolVideoModel}
              disabled={!toolSettings.video || !videoModels.length}
            >
              <SelectTrigger className="w-full sm:w-[40px] px-0 justify-center h-9 glass-card border-0 bg-secondary/50" title="Video Tool Model">
                <Video className="h-4 w-4" />
              </SelectTrigger>
              <SelectContent>
                {videoModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={toolAudioModel}
              onValueChange={setToolAudioModel}
              disabled={!toolSettings.audio || !audioModels.length}
            >
              <SelectTrigger className="w-full sm:w-[40px] px-0 justify-center h-9 glass-card border-0 bg-secondary/50" title="Audio Tool Model">
                <AudioLines className="h-4 w-4" />
              </SelectTrigger>
              <SelectContent>
                {audioModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {onRefreshModels && (
              <Button variant="ghost" size="icon" onClick={onRefreshModels} disabled={modelsLoading} className="h-9 w-9">
                <Sparkles className={cn("h-4 w-4", modelsLoading && "animate-spin")} />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHeaderCollapsed((prev) => !prev)}
              className="h-9 w-9"
              title={headerCollapsed ? "Expand header controls" : "Collapse header controls"}
            >
              {headerCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {!headerCollapsed ? (
            <motion.div
              key="header-controls"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {modelsError ? (
                <div className="max-w-5xl mx-auto w-full pt-2">
                  <p className="text-xs text-destructive">{modelsError}</p>
                </div>
              ) : null}
              <div className="max-w-5xl mx-auto w-full pt-2">
                <div className="glass-card border-0 bg-secondary/30 p-2.5">
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Generation Tools
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Enable/disable tool invocation
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={toolSettings.image ? "secondary" : "ghost"}
                      onClick={() =>
                        setToolSettings((prev) => ({ ...prev, image: !prev.image }))
                      }
                      className="h-8 gap-1.5"
                    >
                      {toolSettings.image ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                      <ImageIcon className="h-3.5 w-3.5" />
                      Image
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={toolSettings.video ? "secondary" : "ghost"}
                      onClick={() =>
                        setToolSettings((prev) => ({ ...prev, video: !prev.video }))
                      }
                      className="h-8 gap-1.5"
                    >
                      {toolSettings.video ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                      <Video className="h-3.5 w-3.5" />
                      Video
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={toolSettings.audio ? "secondary" : "ghost"}
                      onClick={() =>
                        setToolSettings((prev) => ({ ...prev, audio: !prev.audio }))
                      }
                      className="h-8 gap-1.5"
                    >
                      {toolSettings.audio ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                      <AudioLines className="h-3.5 w-3.5" />
                      Audio
                    </Button>
                  </div>
                </div>
              </div>
              <div className="max-w-5xl mx-auto w-full pt-2">
                <div className="glass-card border-0 bg-secondary/30 p-2.5">
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      System Prompt (sent with every message)
                    </p>
                    {customSystemPrompt.trim() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearSystemPrompt}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                  <Textarea
                    value={customSystemPrompt}
                    onChange={(event) => setCustomSystemPrompt(event.target.value)}
                    placeholder="Optional: Add custom behavior/instructions for the assistant."
                    className="min-h-[76px] resize-y border-0 bg-background/70 text-xs focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto min-h-0 container mx-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto py-6 space-y-6 px-4">
          <AnimatePresence initial={false} mode="popLayout">
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-4"
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-primary/60" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-medium">How can I help you create?</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Ask me to generate images, videos, audio, refine prompts, or brainstorm ideas.
                  </p>
                </div>
              </motion.div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user";
                const isTool = message.role === "tool";
                const isAssistant = message.role === "assistant";
                const mediaItems =
                  message.media ??
                  (message.images?.map((image) => ({
                    ...image,
                    kind: "image" as const,
                  })) ??
                    []);

                if (
                  isTool &&
                  !mediaItems.length &&
                  !message.content.trim()
                ) {
                  // Hide empty tool messages only.
                  return null;
                }

                // Parse content for <think> blocks
                let thoughtContent: string | null =
                  typeof message.thinking === "string" && message.thinking.trim()
                    ? message.thinking
                    : null;
                let displayContent = message.content;

                if (isAssistant) {
                  const thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
                  if (thinkMatch) {
                    thoughtContent = thoughtContent
                      ? `${thoughtContent}\n${thinkMatch[1]}`
                      : thinkMatch[1];
                    displayContent = message.content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
                  }
                }

                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      "flex gap-4 group",
                      isUser ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <Avatar className={cn("h-8 w-8 border", isUser ? "bg-primary text-primary-foreground" : "bg-card")}>
                      <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
                        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn(
                      "flex flex-col gap-2 max-w-[85%]",
                      isUser ? "items-end" : "items-start",
                      "w-full"
                    )}>
                      {/* Name/Role */}
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium px-1">
                        {isUser ? "You" : isTool ? "System Helper" : "Agent"}
                      </span>

                      {/* Content */}
                      <div className={cn(
                        "relative rounded-2xl px-5 py-3.5 text-sm shadow-sm w-full transition-all duration-300",
                        isUser
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : isTool
                            ? "bg-secondary/50 text-secondary-foreground border border-border/50 text-xs font-mono"
                            : "glass-card text-foreground rounded-tl-sm"
                      )}>

                        {thoughtContent && <ThinkingBlock content={thoughtContent} />}

                        {displayContent ? (
                          isUser ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{displayContent}</p>
                          ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {displayContent}
                              </ReactMarkdown>
                            </div>
                          )
                        ) : isAssistant ? (
                          <div className="flex items-center gap-2 text-muted-foreground italic text-xs">
                            <Sparkles className="h-3 w-3 animate-pulse" />
                            {message.toolCalls?.length
                              ? `Invoking ${message.toolCalls
                                  .map((tc) => tc.function.name)
                                  .filter(Boolean)
                                  .join(", ")}...`
                              : "Thinking..."}
                          </div>
                        ) : null}

                        {isTool && message.promptUsed ? (
                          <div className="mt-2 rounded-md border border-border/50 bg-background/50 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                Prompt Used
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void copyPromptText(message.id, message.promptUsed ?? "")}
                                className="h-6 px-2 text-[10px]"
                                disabled={!message.promptUsed?.trim()}
                              >
                                {copiedPromptMessageId === message.id ? (
                                  <>
                                    <Check className="mr-1 h-3 w-3" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="mr-1 h-3 w-3" />
                                    Copy
                                  </>
                                )}
                              </Button>
                            </div>
                            <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed">
                              {message.promptUsed}
                            </p>
                          </div>
                        ) : null}

                        {/* Media Grid */}
                        {mediaItems.length ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 w-full">
                            {mediaItems.map((item) => (
                              <motion.div
                                key={item.id}
                                layoutId={item.id}
                                className="relative rounded-lg overflow-hidden border bg-background/50 group/image p-1.5"
                              >
                                {item.kind === "image" ? (
                                  <div className="relative aspect-square rounded-md overflow-hidden">
                                    <img
                                      src={item.dataUrl}
                                      alt="Generated"
                                      className="w-full h-full object-cover transition-transform duration-500 group-hover/image:scale-110"
                                    />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={() => window.open(item.dataUrl, "_blank")}>
                                        <ChevronDown className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : item.kind === "video" ? (
                                  <video
                                    src={item.dataUrl}
                                    controls
                                    className="w-full rounded-md max-h-64 bg-black"
                                  />
                                ) : (
                                  <audio
                                    src={item.dataUrl}
                                    controls
                                    className="w-full"
                                  />
                                )}
                              </motion.div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}

            {busy && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex gap-4"
              >
                <div className="w-8 h-8 flex items-center justify-center">
                  <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.15s] mx-1" />
                  <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="h-4" />
        </div>
      </div>

      {/* Input Area */}
      <footer className="flex-none p-4 glass border-t mt-auto">
        <div className="max-w-3xl mx-auto w-full relative">
          <AnimatePresence>
            {messages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute -top-12 right-0"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearChat}
                  className="text-muted-foreground hover:text-destructive transition-colors gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear Chat
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative glass-card rounded-3xl p-1.5 flex items-end gap-2 shadow-lg ring-1 ring-white/20">
            <div className="flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${providerLabel} Agent...`}
                className="min-h-[48px] max-h-[200px] w-full resize-none border-0 bg-transparent py-3 px-4 focus-visible:ring-0 text-base"
                rows={1}
              />
            </div>
            <Button
              size="icon"
              onClick={() => void submitMessage()}
              disabled={!input.trim() || busy || !apiKey.trim()}
              className={cn(
                "h-10 w-10 rounded-full mb-1 transition-all duration-300 shadow",
                input.trim() ? "bg-primary text-primary-foreground hover:scale-105" : "bg-muted text-muted-foreground"
              )}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
          {chatError ? (
            <p className="mt-2 text-xs text-destructive">{chatError}</p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
