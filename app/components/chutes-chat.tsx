/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  Layers3,
  Search,
  RefreshCw,
  Gauge,
  Paperclip,
  X,
  FileText,
  Maximize2,
  Minimize2,
  Info,
  Code2,
  ExternalLink,
  Square,
  Download,
} from "lucide-react";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import {
  CHUTES_IMAGE_MODELS as STATIC_CHUTES_IMAGE_MODELS,
  CHUTES_LLM_MODELS as STATIC_CHUTES_LLM_MODELS,
  CHUTES_TTS_MODELS as STATIC_CHUTES_TTS_MODELS,
  CHUTES_VIDEO_MODELS as STATIC_CHUTES_VIDEO_MODELS,
  NANOGPT_IMAGE_MODELS as STATIC_NANOGPT_IMAGE_MODELS,
  NANOGPT_LLM_MODELS as STATIC_NANOGPT_LLM_MODELS,
  NANOGPT_VIDEO_MODELS as STATIC_NANOGPT_VIDEO_MODELS,
  MULTILLM_AUDIO_MODELS as STATIC_MULTILLM_AUDIO_MODELS,
  MULTILLM_CHAT_MODELS as STATIC_MULTILLM_CHAT_MODELS,
  MULTILLM_IMAGE_MODELS as STATIC_MULTILLM_IMAGE_MODELS,
  MULTILLM_VIDEO_MODELS as STATIC_MULTILLM_VIDEO_MODELS,
  NAVY_CHAT_MODELS as STATIC_NAVY_CHAT_MODELS,
  NAVY_IMAGE_MODELS as STATIC_NAVY_IMAGE_MODELS,
  NAVY_TTS_MODELS as STATIC_NAVY_TTS_MODELS,
  NAVY_VIDEO_MODELS as STATIC_NAVY_VIDEO_MODELS,
  type ModelOption,
  type ChatProvider,
  type Provider,
} from "@/lib/constants";
import {
  CHAT_PROVIDER_OPTIONS,
  chatProviderDisplayName,
  chatProviderHeading,
} from "@/lib/chat-providers";
import type { NavyUsageResponse } from "@/lib/types";
import { dataUrlFromBase64, fetchAsDataUrl, cn } from "@/lib/utils";
import {
  ensureSelectedModelOption,
  filterModelOptions,
  hasModelMetadata,
  isFetchedOnlyModel,
} from "@/lib/model-options";
import { buildChatGenerationSystemPrompt } from "@/lib/chat-generation-prompt";
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
import {
  type ChatAttachmentAsset,
  type ChatImageAsset,
  type ChatMediaPreview,
  type ChatMediaAsset,
  type ChatTurnIntent,
  buildChatMediaPreview,
  buildAssistantToolContextContent,
  buildCancelledToolResults,
  buildNanoGptImageToolRequest,
  buildNanoGptVideoToolRequest,
  createSyntheticFallbackToolCall,
  isDeepSeekV4Model,
  isChatVideoModelSupported,
  normalizeImageToolModelRequest,
  repairImageToolArguments,
  resolveChatTurnIntent,
  resolveChatTurnToolPolicy,
  resolveNavyVideoStartResult,
  resolveToolArguments,
  resolveRequestedImageModels,
  runImageModelPipelineParallel,
  sanitizeChatAttachmentAssets,
  sanitizeChatImageAssets,
  sanitizeChatMediaAssets,
  stripHeavyMediaFromMessagesForStorage,
  toChatCompletionMessages,
} from "@/lib/chat-tooling";
import {
  buildSaferImagePromptForModel,
  buildImagePolicyRecoveryPrompt,
  isLikelyImagePolicyError,
  isFluxModel,
  NAVY_JOB_POLL_INTERVAL_MS,
  NAVY_JOB_POLL_MAX_ATTEMPTS,
  normalizeImageRetryAttempts,
  prepareImageModelRequests,
  resolveImagePromptRecoveryChatModels,
  resolveNavyJobPollDelayMs,
  resolveNavyChatImageSizing,
  summarizeImageModelPrompts,
} from "@/lib/studio-generation";
import { extractPdfTextFromFile, isSupportedPdfFile } from "@/lib/client/pdf-text";
import { ImageViewer } from "./image-viewer";
import { mediaExtensionFromMimeType } from "@/lib/media-files";
import {
  chatModelToolSupport,
  extractAIChatStreamState,
  type AIChatToolCall,
  type AIChatToolName,
} from "@/lib/ai-sdk-chat";

type ToolCall = AIChatToolCall;

type ChatMessage = {
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
};

type QueuedChatTurn = {
  id: string;
  content: string;
  attachments: ChatAttachmentAsset[];
  turnIntent: ChatTurnIntent;
};

type ChutesChatProps = {
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
  setImageModelOrder: React.Dispatch<React.SetStateAction<string[]>>;
  imageRetryAttempts: number;
  setImageRetryAttempts: (value: number) => void;
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
const getReasoningPreferencesStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_reasoning_preferences`;
const MAX_CHAT_MESSAGES = 120;
const MAX_CHAT_TOOL_ROUNDS = 6;
const MAX_CHAT_MODEL_STEPS = MAX_CHAT_TOOL_ROUNDS + 1;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 80;
const MAX_PENDING_ATTACHMENTS = 6;
const CHAT_TEXT_ATTACHMENT_MAX_CHARS = 18_000;
const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const CHAT_TURN_INTENTS: readonly ChatTurnIntent[] = [
  "auto",
  "chat",
  "generate_image",
  "generate_video",
  "generate_audio",
];

const isChatTurnIntent = (value: unknown): value is ChatTurnIntent =>
  typeof value === "string" &&
  (CHAT_TURN_INTENTS as readonly string[]).includes(value);

const chatTurnIntentLabel = (intent: ChatTurnIntent) => {
  if (intent === "auto") return "Auto · Agent decides";
  if (intent === "chat") return "Chat only";
  if (intent === "generate_image") return "Create image";
  if (intent === "generate_video") return "Create video";
  return "Create audio";
};

const chatTurnIntentCompactLabel = (intent: ChatTurnIntent) => {
  if (intent === "auto") return "Auto";
  if (intent === "chat") return "Chat only";
  return chatTurnIntentLabel(intent);
};

const isAbortLikeError = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted === true ||
  (error instanceof Error && error.name === "AbortError");

const abortableDelay = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
];

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

const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  value === "none" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh";

const sanitizeReasoningPreferences = (value: unknown): Record<string, ReasoningEffort> => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, ReasoningEffort>>(
    (acc, [modelId, effort]) => {
      if (modelId.trim() && isReasoningEffort(effort)) {
        acc[modelId] = effort;
      }
      return acc;
    },
    {},
  );
};

const formatCount = (value?: number | null) =>
  typeof value === "number" ? value.toLocaleString() : value === null ? "unknown" : "-";

const formatUsageAge = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString() : null;

const formatModelWindow = (value?: number | null) =>
  typeof value === "number" ? value.toLocaleString() : value === null ? "unknown" : "";

const normalizeModalityList = (value?: string[] | null) =>
  (value ?? [])
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const summarizeModalities = (value?: string[] | null) => {
  const normalized = normalizeModalityList(value);
  return normalized.length ? normalized.join(", ") : "unknown";
};

const acceptsTextFile = (file: File) => {
  const type = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type.startsWith("text/") ||
    /\.(txt|md|markdown|csv|json|log|xml|yaml|yml)$/i.test(file.name)
  );
};

const fileToDataUrl = async (file: File) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });

const idsFor = (models: ModelOption[]) => new Set(models.map((model) => model.id));

const idsForGroups = (groups: ModelOption[][]) =>
  new Set(groups.flatMap((models) => models.map((model) => model.id)));

const STATIC_MODEL_IDS = {
  chutes: {
    chat: idsFor(STATIC_CHUTES_LLM_MODELS),
    image: idsForGroups([STATIC_CHUTES_IMAGE_MODELS, STATIC_NANOGPT_IMAGE_MODELS]),
    video: idsForGroups([STATIC_CHUTES_VIDEO_MODELS, STATIC_NANOGPT_VIDEO_MODELS]),
    audio: idsFor(STATIC_CHUTES_TTS_MODELS),
  },
  navy: {
    chat: idsFor(STATIC_NAVY_CHAT_MODELS),
    image: idsForGroups([STATIC_NAVY_IMAGE_MODELS, STATIC_NANOGPT_IMAGE_MODELS]),
    video: idsForGroups([STATIC_NAVY_VIDEO_MODELS, STATIC_NANOGPT_VIDEO_MODELS]),
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
} satisfies Record<ChatProvider, Record<"chat" | "image" | "video" | "audio", Set<string>>>;

const isImageToolProvider = (value: unknown): value is Provider =>
  value === "chutes" ||
  value === "navy" ||
  value === "nanogpt" ||
  value === "multillm";

const imageEndpointForProvider = (provider: Provider) => {
  if (provider === "navy") return "/api/navy/image";
  if (provider === "nanogpt") return "/api/nanogpt/image";
  if (provider === "multillm") return "/api/multillm/image";
  return "/api/chutes/image";
};

const imageProviderLabel = (provider: Provider) => {
  if (provider === "navy") return "NavyAI";
  if (provider === "nanogpt") return "NanoGPT";
  if (provider === "multillm") return "MultiLLM";
  return "Chutes";
};

const modelSupportsReasoning = (
  provider: ChatProvider,
  modelId: string,
  modelOption?: ModelOption,
) =>
  (provider === "navy" ||
    provider === "nanogpt" ||
    provider === "multillm") &&
  (modelOption?.supportsReasoning === true || isDeepSeekV4Model(modelId));

function NavyUsageFooter({
  usage,
  error,
  loading,
  updatedAt,
  onRefresh,
}: {
  usage?: NavyUsageResponse | null;
  error?: string | null;
  loading?: boolean;
  updatedAt?: string | null;
  onRefresh?: () => Promise<void> | void;
}) {
  const usagePercent =
    typeof usage?.usage?.percent_used === "number" ? usage.usage.percent_used : null;
  const updatedLabel = formatUsageAge(updatedAt);

  return (
    <div className="border-t border-border/50 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 flex-none" />
          <span className="truncate font-medium text-foreground">
            {usage
              ? `${formatCount(usage.usage.tokens_remaining_today)} tokens left`
              : error
                ? "Usage unavailable"
                : "Usage not checked"}
          </span>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-background/70 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Check
          </button>
        ) : null}
      </div>
      {usage ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span>{formatCount(usage.usage.tokens_used_today)} used today</span>
          <span>{usagePercent !== null ? `${usagePercent.toFixed(1)}%` : "-"}</span>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      {updatedLabel ? <p className="mt-1 opacity-70">Updated {updatedLabel}</p> : null}
    </div>
  );
}

function ModelSearchSelect({
  value,
  onValueChange,
  models,
  staticModelIds,
  placeholder,
  ariaLabel,
  title,
  triggerClassName,
  icon,
  compact = false,
  disabled = false,
  footer,
}: {
  value: string;
  onValueChange: (value: string) => void;
  models: ModelOption[];
  staticModelIds?: ReadonlySet<string>;
  placeholder: string;
  ariaLabel: string;
  title: string;
  triggerClassName?: string;
  icon?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const options = useMemo(
    () => ensureSelectedModelOption(models, value),
    [models, value],
  );
  const selectedModel = options.find((model) => model.id === value);
  const filteredOptions = useMemo(
    () => filterModelOptions(options, query),
    [options, query],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      const width = Math.min(384, Math.max(160, window.innerWidth - viewportPadding * 2));
      const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        maxLeft,
      );
      const maxHeight = Math.min(384, window.innerHeight - viewportPadding * 2);
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const openAbove = spaceBelow < 260 && rect.top > spaceBelow;
      const top = openAbove
        ? Math.max(viewportPadding, rect.top - maxHeight - 4)
        : Math.min(rect.bottom + 4, window.innerHeight - maxHeight - viewportPadding);
      setMenuStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const selectedFetchedOnly = selectedModel
    ? isFetchedOnlyModel(selectedModel, staticModelIds)
    : false;

  return (
    <div ref={rootRef} className={cn("relative flex-none", !compact && "min-w-0")}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "glass-card h-9 min-w-0 border-0 bg-secondary/50 text-sm font-normal",
          compact
            ? "w-9 justify-center px-0"
            : "justify-between px-3 sm:w-[240px]",
          triggerClassName,
        )}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        {compact ? (
          icon
        ) : (
          <>
            <span className="min-w-0 truncate text-left">
              {selectedModel?.label ?? (value || placeholder)}
            </span>
            <span className="ml-2 flex flex-none items-center gap-1">
              {selectedFetchedOnly ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  New
                </span>
              ) : null}
              {typeof selectedModel?.tokenMultiplier === "number" ? (
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                  {selectedModel.tokenMultiplier}x
                </span>
              ) : null}
              <ChevronDown className="h-4 w-4 opacity-50" />
            </span>
          </>
        )}
      </Button>
      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-50 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="border-b border-border/50 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={ariaLabel}>
            {filteredOptions.length ? (
              filteredOptions.map((modelOption) => {
                const selected = modelOption.id === value;
                const fetchedOnly = isFetchedOnlyModel(modelOption, staticModelIds);
                const metadata = hasModelMetadata(modelOption);
                return (
                  <button
                    key={modelOption.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onValueChange(modelOption.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                      selected && "bg-accent text-accent-foreground",
                    )}
                  >
                    <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center">
                      {selected ? <Check className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium">{modelOption.label}</span>
                        {fetchedOnly ? (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            New
                          </span>
                        ) : null}
                        {modelOption.premium ? (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                            Premium
                          </span>
                        ) : null}
                        {typeof modelOption.tokenMultiplier === "number" ? (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                            {modelOption.tokenMultiplier}x tokens
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {modelOption.id}
                      </span>
                      {metadata ? (
                        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                          {[
                            modelOption.endpoint,
                            modelOption.contextWindow !== undefined
                              ? `ctx ${formatModelWindow(modelOption.contextWindow)}`
                              : "",
                            modelOption.maxOutputTokens !== undefined
                              ? `out ${formatModelWindow(modelOption.maxOutputTokens)}`
                              : "",
                            modelOption.inputModalities?.length
                              ? `in ${modelOption.inputModalities.join(",")}`
                              : "",
                            modelOption.outputModalities?.length
                              ? `out ${modelOption.outputModalities.join(",")}`
                              : "",
                            modelOption.metadataStatus,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No models match this search.
              </p>
            )}
          </div>
          {footer}
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}

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

export const sanitizeChatMessages = (value: unknown): ChatMessage[] => {
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
      if (isChatTurnIntent(record.turnIntent)) {
        message.turnIntent = record.turnIntent;
      }

      if (Array.isArray(record.toolCalls)) {
        const toolCalls = record.toolCalls
          .map((tc): ToolCall | null => {
            if (!tc || typeof tc !== "object") return null;
            const tcRecord = tc as Record<string, unknown>;
            const tcId = typeof tcRecord.id === "string" ? tcRecord.id : "";
            const fn = tcRecord.function;
            if (!fn || typeof fn !== "object") return null;
            const fnRecord = fn as Record<string, unknown>;
            const fnName = typeof fnRecord.name === "string" ? fnRecord.name : "";
            const fnArgs = typeof fnRecord.arguments === "string" ? fnRecord.arguments : "";
            const extraContent =
              tcRecord.extra_content && typeof tcRecord.extra_content === "object"
                ? (tcRecord.extra_content as Record<string, unknown>)
                : null;
            const google =
              extraContent?.google && typeof extraContent.google === "object"
                ? (extraContent.google as Record<string, unknown>)
                : null;
            const thoughtSignature =
              typeof google?.thought_signature === "string" &&
              google.thought_signature.length > 0 &&
              google.thought_signature.length <= 65_536
                ? google.thought_signature
                : null;
            if (!tcId || !fnName) return null;
            return {
              id: tcId,
              type: "function" as const,
              function: {
                name: fnName,
                arguments: fnArgs,
              },
              ...(thoughtSignature
                ? {
                    extra_content: {
                      google: { thought_signature: thoughtSignature },
                    },
                  }
                : {}),
            };
          })
          .filter((entry): entry is ToolCall => entry !== null);
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
        const attachments = sanitizeChatAttachmentAssets(record.attachments);
        if (attachments.length) message.attachments = attachments;
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

function ToolCallsBlock({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (!toolCalls.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {toolCalls.map((toolCall) => {
        const rawArgs = toolCall.function.arguments;
        let formattedArgs = rawArgs;
        let promptPreview = "";

        try {
          const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
          formattedArgs = JSON.stringify(parsed, null, 2);
          const promptValue = parsed.prompt ?? parsed.input ?? parsed.text;
          promptPreview = typeof promptValue === "string" ? promptValue : "";
        } catch {
          // Tool arguments arrive as streamed JSON fragments, so invalid JSON is expected mid-stream.
        }

        return (
          <div
            key={toolCall.id}
            className="rounded-xl border border-primary/15 bg-primary/5 p-2.5 text-xs"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                <span className="truncate">Calling {toolCall.function.name}</span>
              </div>
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                streaming
              </span>
            </div>
            {promptPreview ? (
              <div className="mb-2 rounded-lg border border-border/40 bg-background/60 p-2">
                <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Prompt
                </p>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground/85">
                  {promptPreview}
                </p>
              </div>
            ) : null}
            {formattedArgs ? (
              <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {formattedArgs}
              </pre>
            ) : (
              <p className="text-muted-foreground">Waiting for tool arguments...</p>
            )}
          </div>
        );
      })}
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
  allowServerApiKey = false,
  provider,
  setProvider,
  models,
  model,
  setModel,
  imageModels,
  imageApiKeys,
  videoModels,
  videoApiKeys,
  audioModels,
  toolImageModel,
  setToolImageModel,
  imagePipelineEnabled,
  setImagePipelineEnabled,
  imageModelOrder,
  setImageModelOrder,
  imageRetryAttempts,
  setImageRetryAttempts,
  onRefreshModels,
  modelsLoading,
  modelsError,
  navyUsage,
  navyUsageError,
  navyUsageLoading,
  navyUsageUpdatedAt,
  onRefreshUsage,
  saveToGallery = false,
  videoImage,
  videoAspect,
  videoDuration,
  ttsVoice,
  ttsFormat,
  ttsSpeed,
  initialInput,
  onSaveImages,
}: ChutesChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [turnIntent, setTurnIntent] = useState<ChatTurnIntent>("auto");
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [systemPromptHydrated, setSystemPromptHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const latestGeneratedImageRef = useRef<string | null>(videoImage ?? null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const queuedTurnsRef = useRef<QueuedChatTurn[]>([]);
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachmentAsset[]>([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeMediaPreview, setActiveMediaPreview] = useState<ChatMediaPreview | null>(null);
  const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
  const [embedOrigin, setEmbedOrigin] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedPromptMessageId, setCopiedPromptMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const consumedInitialInputRef = useRef<string | null>(null);
  const reasoningPreferenceModelRef = useRef("");
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
  const reasoningPreferencesStorageKey = useMemo(
    () => getReasoningPreferencesStorageKey(provider),
    [provider]
  );
  const providerLabel = chatProviderDisplayName(provider);
  const providerHeading = chatProviderHeading(provider);
  const hasApiAccess = Boolean(apiKey.trim()) || allowServerApiKey;
  const staticModelIds = STATIC_MODEL_IDS[provider];
  const navyToolUsageFooter =
    provider === "navy" ? (
      <NavyUsageFooter
        usage={navyUsage}
        error={navyUsageError}
        loading={navyUsageLoading}
        updatedAt={navyUsageUpdatedAt}
        onRefresh={onRefreshUsage}
      />
    ) : null;
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
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
  const [toolSettingsHydrated, setToolSettingsHydrated] = useState(false);
  const [reasoningPreferencesHydrated, setReasoningPreferencesHydrated] = useState(false);
  const setChatBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);
  const commitMessages = useCallback((nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  }, []);
  const updateQueuedTurns = useCallback((
    updater: QueuedChatTurn[] | ((prev: QueuedChatTurn[]) => QueuedChatTurn[])
  ) => {
    const nextTurns =
      typeof updater === "function" ? updater(queuedTurnsRef.current) : updater;
    queuedTurnsRef.current = nextTurns;
    setQueuedTurns(nextTurns);
    return nextTurns;
  }, []);
  const enqueueChatTurn = useCallback((
    content: string,
    attachments: ChatAttachmentAsset[],
    queuedTurnIntent: ChatTurnIntent
  ) => {
    updateQueuedTurns((prev) => [
      ...prev,
      {
        id: createId(),
        content,
        attachments,
        turnIntent: queuedTurnIntent,
      },
    ]);
  }, [updateQueuedTurns]);
  const takeNextQueuedTurn = useCallback((): QueuedChatTurn | null => {
    let nextTurn: QueuedChatTurn | null = null;
    updateQueuedTurns((prev) => {
      if (!prev.length) return prev;
      const [head, ...rest] = prev;
      nextTurn = head;
      return rest;
    });
    return nextTurn;
  }, [updateQueuedTurns]);
  const selectedChatModel = useMemo(
    () => ensureSelectedModelOption(models, model).find((entry) => entry.id === model),
    [models, model],
  );
  const inputModalities = useMemo(
    () => normalizeModalityList(selectedChatModel?.inputModalities),
    [selectedChatModel]
  );
  const outputModalities = useMemo(
    () => normalizeModalityList(selectedChatModel?.outputModalities),
    [selectedChatModel]
  );
  const supportsImageAttachments =
    selectedChatModel?.supportsVision === true || inputModalities.includes("image");
  const supportsFileAttachments =
    inputModalities.includes("file") ||
    inputModalities.includes("document") ||
    inputModalities.includes("pdf");
  const supportsAudioInput =
    selectedChatModel?.supportsAudioInput === true || inputModalities.includes("audio");
  const supportsVideoInput = inputModalities.includes("video");
  const attachmentAccept = [
    supportsImageAttachments ? "image/png,image/jpeg,image/webp,image/gif" : "",
    supportsFileAttachments
      ? "application/pdf,.pdf,text/plain,text/markdown,.txt,.md,.markdown,.csv,.json,.log"
      : "",
  ]
    .filter(Boolean)
    .join(",");
  const attachmentUploadDisabled = !supportsImageAttachments && !supportsFileAttachments;
  const isDeepSeekV4ChatModel =
    (provider === "navy" ||
      provider === "nanogpt" ||
      provider === "multillm") &&
    isDeepSeekV4Model(model);
  const chatModelSupportsReasoning = modelSupportsReasoning(provider, model, selectedChatModel);
  const chatModelToolCapability = chatModelToolSupport(selectedChatModel);
  useEffect(() => {
    if (videoImage) latestGeneratedImageRef.current = videoImage;
  }, [videoImage]);
  const availableImageModelIds = useMemo(
    () => new Set(imageModels.map((item) => item.id)),
    [imageModels]
  );
  const imageProviderByModelId = useMemo(() => {
    const entries = new Map<string, Provider>();
    for (const item of imageModels) {
      entries.set(
        item.id,
        isImageToolProvider(item.provider) ? item.provider : provider
      );
    }
    return entries;
  }, [imageModels, provider]);
  const imageApiKeyForProvider = useCallback(
    (targetProvider: Provider) =>
      (imageApiKeys?.[targetProvider] ?? (targetProvider === provider ? apiKey : "")).trim(),
    [apiKey, imageApiKeys, provider]
  );
  const videoModelById = useMemo(
    () => new Map(videoModels.map((item) => [item.id, item])),
    [videoModels]
  );
  const videoProviderByModelId = useMemo(() => {
    const entries = new Map<string, Provider>();
    for (const item of videoModels) {
      entries.set(
        item.id,
        isImageToolProvider(item.provider) ? item.provider : provider
      );
    }
    return entries;
  }, [videoModels, provider]);
  const videoApiKeyForProvider = useCallback(
    (targetProvider: Provider) =>
      (videoApiKeys?.[targetProvider] ?? (targetProvider === provider ? apiKey : "")).trim(),
    [apiKey, provider, videoApiKeys]
  );
  const orderedToolImageModels = useMemo(
    () => imageModelOrder.filter((entry) => availableImageModelIds.has(entry)),
    [availableImageModelIds, imageModelOrder]
  );
  const activeToolImageModels = useMemo(
    () =>
      resolveRequestedImageModels({
        requestedModel: "",
        defaultModel: toolImageModel,
        imagePipelineEnabled,
        imageModelOrder,
        availableModels: imageModels.map((item) => item.id),
      }),
    [imageModels, imageModelOrder, imagePipelineEnabled, toolImageModel]
  );
  const refreshNavyUsageAfterMediaTool = () => {
    if (provider !== "navy" || !onRefreshUsage) return;
    void Promise.resolve(onRefreshUsage()).catch(() => {
      // The generation result is more important than a best-effort usage refresh.
    });
  };

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setPendingAttachments((prev) => {
      const next = prev.filter((attachment) => {
        if (attachment.kind === "image") return supportsImageAttachments;
        return supportsFileAttachments;
      });
      if (next.length !== prev.length) {
        setAttachmentError("Removed attachments that the selected model does not advertise support for.");
      }
      return next;
    });
  }, [supportsFileAttachments, supportsImageAttachments]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEmbedOrigin(window.location.origin);
    const params = new URLSearchParams(window.location.search);
    if (params.get("fullscreen") === "1") {
      setFullscreen(true);
    }
  }, []);

  useEffect(() => {
    const nextInput = initialInput?.trim() ?? "";
    if (!nextInput || consumedInitialInputRef.current === initialInput) return;
    consumedInitialInputRef.current = initialInput ?? null;
    setInput(initialInput ?? "");
    setChatError(null);
  }, [initialInput]);
  const reorderPipelineModel = (id: string, direction: "up" | "down") => {
    setImageModelOrder((prev) => {
      const next = prev.filter((entry) => availableImageModelIds.has(entry));
      const index = next.indexOf(id);
      if (index === -1) return next;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return next;
      const reordered = [...next];
      const [item] = reordered.splice(index, 1);
      reordered.splice(targetIndex, 0, item);
      return reordered;
    });
  };
  const togglePipelineModel = (id: string) => {
    setImageModelOrder((prev) => {
      const next = prev.filter((entry) => availableImageModelIds.has(entry));
      return next.includes(id)
        ? next.filter((entry) => entry !== id)
        : [...next, id];
    });
  };

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
        commitMessages(storedMessages);
      }
    };

    commitMessages([]);
    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [storageKey, commitMessages]);

  useEffect(() => {
    if (messages.length <= MAX_CHAT_MESSAGES) return;
    commitMessages(messages.slice(-MAX_CHAT_MESSAGES));
  }, [messages, storageKey, commitMessages]);

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

    setToolSettings(nextToolSettings);
    setToolVideoModel(storedToolVideoModel || fallbackVideoModel);
    setToolAudioModel(storedToolAudioModel || fallbackAudioModel);
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
    if (!toolVideoModel) {
      setToolVideoModel(videoModels[0].id);
    }
  }, [videoModels, toolVideoModel]);

  useEffect(() => {
    if (!audioModels.length) return;
    if (!toolAudioModel) {
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
    reasoningPreferenceModelRef.current = "";
    const handle = window.setTimeout(() => {
      const preferences = sanitizeReasoningPreferences(
        readLocalStorage<unknown>(reasoningPreferencesStorageKey, {})
      );
      setReasoningEffort(preferences[model] ?? "high");
      reasoningPreferenceModelRef.current = model;
      setReasoningPreferencesHydrated(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [model, reasoningPreferencesStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!reasoningPreferencesHydrated || !model || !chatModelSupportsReasoning) return;
    if (reasoningPreferenceModelRef.current !== model) return;
    const handle = window.setTimeout(() => {
      const preferences = sanitizeReasoningPreferences(
        readLocalStorage<unknown>(reasoningPreferencesStorageKey, {})
      );
      preferences[model] = reasoningEffort;
      writeLocalStorage(reasoningPreferencesStorageKey, JSON.stringify(preferences));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [
    chatModelSupportsReasoning,
    model,
    reasoningEffort,
    reasoningPreferencesHydrated,
    reasoningPreferencesStorageKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = stripHeavyMediaFromMessagesForStorage(
      messages.filter((message) => !message.transient),
      MAX_CHAT_MESSAGES
    );
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

  // Track if user is near bottom; if they scroll up during streaming we stop forcing scroll.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateAutoScroll = () => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      shouldAutoScrollRef.current =
        distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
    };

    updateAutoScroll();
    element.addEventListener("scroll", updateAutoScroll, { passive: true });
    return () => element.removeEventListener("scroll", updateAutoScroll);
  }, []);

  // Auto-scroll only when user is already near bottom.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (!shouldAutoScrollRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, busy]);

  const toolAvailability = useMemo(
    () => ({
      image: toolSettings.image && imageModels.length > 0,
      video: toolSettings.video && videoModels.length > 0,
      audio: toolSettings.audio && audioModels.length > 0,
    }),
    [audioModels.length, imageModels.length, toolSettings, videoModels.length]
  );
  const currentTurnDecision = useMemo(
    () => resolveChatTurnIntent(input, toolAvailability, turnIntent),
    [input, toolAvailability, turnIntent]
  );
  const enabledChatTools = useMemo<AIChatToolName[]>(() => {
    if (chatModelToolCapability === false) return [];
    const enabled: AIChatToolName[] = [];
    if (toolSettings.image && imageModels.length) enabled.push("generate_image");
    if (toolSettings.video && videoModels.length) enabled.push("generate_video");
    if (toolSettings.audio && audioModels.length) enabled.push("generate_audio");
    return enabled;
  }, [audioModels.length, chatModelToolCapability, imageModels.length, toolSettings, videoModels.length]);
  const systemPrompt = useMemo(() => {
    const orderedImageModels = activeToolImageModels
      .map((id) => imageModels.find((entry) => entry.id === id))
      .filter((entry): entry is ModelOption => Boolean(entry));
    const selectedImageModel =
      imageModels.find((entry) => entry.id === toolImageModel) ??
      orderedImageModels[0];
    const imageFallbackModels = orderedImageModels.filter(
      (entry) => entry !== selectedImageModel
    );
    const selectedVideoModel = videoModelById.get(toolVideoModel);
    const selectedAudioModel = audioModels.find(
      (entry) => entry.id === toolAudioModel
    );

    return buildChatGenerationSystemPrompt({
      customPrompt: customSystemPrompt,
      imageModel:
        toolSettings.image && imageModels.length
          ? selectedImageModel
          : undefined,
      imageFallbackModels,
      videoModel:
        toolSettings.video && videoModels.length
          ? selectedVideoModel
          : undefined,
      audioModel:
        toolSettings.audio && audioModels.length
          ? selectedAudioModel
          : undefined,
    });
  }, [
    activeToolImageModels,
    audioModels,
    customSystemPrompt,
    imageModels,
    toolAudioModel,
    toolImageModel,
    toolSettings,
    toolVideoModel,
    videoModelById,
    videoModels.length,
  ]);

  const callChatStreaming = async (
    items: ChatMessage[],
    onUpdate: (update: {
      content?: string;
      thinking?: string;
      toolCalls?: ToolCall[];
    }) => void,
    toolChoiceOverride?: unknown,
    options: {
      allowTools?: boolean;
      activeTools?: AIChatToolName[] | null;
      signal?: AbortSignal;
    } = {}
  ) => {
    const requestTools =
      options.allowTools === false
        ? []
        : options.activeTools
          ? enabledChatTools.filter((name) => options.activeTools?.includes(name))
          : enabledChatTools;
    const reasoningPayload =
      (provider === "navy" ||
        provider === "nanogpt" ||
        provider === "multillm") &&
      chatModelSupportsReasoning
        ? {
            ...(isDeepSeekV4ChatModel
              ? {
                  thinking: {
                    type: reasoningEffort === "none" ? "disabled" : "enabled",
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
              }
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
  const readAssistantTextResponse = async (response: Response) => {
    if (!response.body) {
      throw new Error("No response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let contentAcc = "";
    let rawAcc = "";
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === "[DONE]") return;
        try {
          const json = JSON.parse(event.data);
          const choice = json.choices?.[0];
          const delta =
            choice?.delta && typeof choice.delta === "object"
              ? (choice.delta as Record<string, unknown>)
              : null;
          const message =
            choice?.message && typeof choice.message === "object"
              ? (choice.message as Record<string, unknown>)
              : null;
          contentAcc +=
            extractTextFragment(delta?.content) ||
            extractTextFragment(message?.content) ||
            "";
        } catch {
          // Ignore malformed stream chunks; callers fall back if no text arrives.
        }
      },
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawAcc += chunk;
        parser.feed(chunk);
      }
      const finalChunk = decoder.decode();
      if (finalChunk) {
        rawAcc += finalChunk;
        parser.feed(finalChunk);
      }
    } finally {
      reader.releaseLock();
    }

    if (contentAcc.trim()) return contentAcc.trim();
    const raw = rawAcc.trim();
    if (!raw.startsWith("{")) return "";
    try {
      const json = JSON.parse(raw);
      return extractTextFragment(json?.choices?.[0]?.message?.content).trim();
    } catch {
      return "";
    }
  };

  const normalizeRecoveredImagePrompt = (value: string) => {
    const trimmed = value
      .trim()
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/```$/i, "")
      .replace(/^(?:final\s+)?(?:rewritten\s+)?(?:image\s+)?prompt\s*:\s*/i, "")
      .trim();
    if (trimmed.length < 12) return "";
    if (/\b(?:i can(?:not|'t)|sorry|unable to)\b/i.test(trimmed)) return "";
    return trimmed;
  };

  const recoverImagePromptAfterPolicyFailure = async ({
    targetModel,
    currentPrompt,
    errorMessage,
    nextAttempt,
    maxAttempts,
    signal,
  }: {
    targetModel: string;
    currentPrompt: string;
    errorMessage: string;
    nextAttempt: number;
    maxAttempts: number;
    signal?: AbortSignal;
  }) => {
    const fallbackPrompt = buildSaferImagePromptForModel(targetModel, currentPrompt);
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
              id: createId(),
              role: "user",
              content: recoveryInstruction,
            },
          ],
          () => undefined,
          undefined,
          { allowTools: false, signal }
        );
        const recoveredPrompt = normalizeRecoveredImagePrompt(recovered.content);
        if (recoveredPrompt) return recoveredPrompt;
      } catch (error) {
        if (isAbortLikeError(error, signal)) throw error;
      }
      return fallbackPrompt;
    }

    const endpoint = provider === "navy" ? "/api/navy/chat" : "/api/chutes/chat";
    const recoveryModels = resolveImagePromptRecoveryChatModels({
      provider,
      activeModel: model,
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
                  "You rewrite image-generation prompts after provider moderation rejections. Return only one direct image prompt. Preserve the requested artistic medium, composition, mood, lighting, camera/framing, and quality level while removing unsafe details.",
              },
              { role: "user", content: recoveryInstruction },
            ],
            toolChoice: "none",
            maxTokens: 700,
            ...(provider === "navy" && isDeepSeekV4Model(recoveryModel)
              ? {
                  thinking: { type: "disabled" },
                }
              : {}),
          }),
          signal,
        });
        if (!response.ok) continue;
        const recoveredPrompt = normalizeRecoveredImagePrompt(
          await readAssistantTextResponse(response)
        );
        if (recoveredPrompt) return recoveredPrompt;
      } catch (error) {
        if (isAbortLikeError(error, signal)) throw error;
        // Try the next recovery model before falling back to the local rewrite.
      }
    }

    return fallbackPrompt;
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

  const getStringOrStringArrayArg = (
    args: Record<string, unknown>,
    keys: string[],
    maxItems = 5
  ) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.trim().length) {
        return value.trim();
      }
      if (Array.isArray(value)) {
        const values = value
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
          .slice(0, maxItems);
        if (values.length) return values;
      }
    }
    return undefined;
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

  const runGenerateImage = async (
    args: Record<string, unknown>,
    context?: { assistantContent: string; userPrompt: string },
    onModelProgress?: (update: {
      model: string;
      status: "running" | "rewriting" | "success" | "error";
      attempt?: number;
      maxAttempts?: number;
      prompt?: string;
      images?: ChatImageAsset[];
      error?: string;
    }) => void,
    signal?: AbortSignal
  ) => {
    const rawRequestedModel = getStringArg(args, ["model"]);
    const requestedModel = normalizeImageToolModelRequest({
      requestedModel: rawRequestedModel,
    });
    const modelsToRun = resolveRequestedImageModels({
      requestedModel,
      defaultModel: toolImageModel,
      imagePipelineEnabled,
      imageModelOrder,
      availableModels: imageModels.map((item) => item.id),
    });
    if (!modelsToRun.length) {
      throw new Error("No image models are available for the image tool.");
    }
    const finalArgs =
      context && modelsToRun.some(isFluxModel)
        ? repairImageToolArguments(args, context, { preferAssistantPrompt: true })
        : args;
    const prompt = getStringArg(finalArgs, ["prompt"]);
    if (!prompt) {
      throw new Error("Tool call missing prompt.");
    }
    const negativePrompt = getStringArg(finalArgs, ["negative_prompt"]);
    const imageRequests = modelsToRun.map((targetModel) => {
      const targetProvider = imageProviderByModelId.get(targetModel) ?? provider;
      const targetModelOption = imageModels.find((entry) => entry.id === targetModel);
      if (targetProvider === "multillm") {
        const size = getStringArg(finalArgs, ["size"]);
        const aspectRatio = getStringArg(finalArgs, [
          "aspect_ratio",
          "aspectRatio",
        ]);
        const quality = getStringArg(finalArgs, ["quality"]);
        const imageInput = getStringOrStringArrayArg(finalArgs, [
          "image_url",
          "image",
        ]);
        return {
          model: targetModel,
          prompt,
          body: {
            model: targetModel,
            prompt,
            negativePrompt: negativePrompt || undefined,
            size: size || undefined,
            aspectRatio: aspectRatio || undefined,
            quality: quality || undefined,
            imageDataUrl:
              typeof imageInput === "string" ? imageInput : undefined,
            imageDataUrls: Array.isArray(imageInput)
              ? imageInput
              : undefined,
            numberOfImages: 1,
            sync: false,
          },
        };
      }
      if (targetProvider === "nanogpt" && targetModelOption) {
        const [prepared] = prepareImageModelRequests({
          models: [targetModel],
          baseBody: {},
          prompt,
          negativePrompt: negativePrompt || undefined,
          includeNegativePrompt: false,
        });
        return {
          ...prepared,
          body: buildNanoGptImageToolRequest({
            model: targetModelOption,
            prompt: prepared.prompt,
            args: finalArgs,
          }),
        };
      }

      const baseBody: Record<string, unknown> = {};
      const imageUrl = getStringOrStringArrayArg(finalArgs, ["image_url", "image"]);
      if (targetProvider === "navy") {
        const size = getStringArg(finalArgs, ["size"]);
        const quality = getStringArg(finalArgs, ["quality"]);
        const style = getStringArg(finalArgs, ["style"]);
        if (size) Object.assign(baseBody, resolveNavyChatImageSizing(size));
        if (quality) baseBody.quality = quality;
        if (style) baseBody.style = style;
        if (imageUrl) baseBody.imageUrl = imageUrl;
        baseBody.sync = false;
      } else {
        const guidanceScale = getNumberArg(finalArgs, ["guidance_scale"]);
        const width = getNumberArg(finalArgs, ["width"]);
        const height = getNumberArg(finalArgs, ["height"]);
        const steps = getNumberArg(finalArgs, ["num_inference_steps"]);
        const seed = getNumberArg(finalArgs, ["seed"]);
        const resolution = getStringArg(finalArgs, ["resolution"]);
        baseBody.guidanceScale = guidanceScale ?? undefined;
        baseBody.width = width ? Math.round(width) : undefined;
        baseBody.height = height ? Math.round(height) : undefined;
        baseBody.resolution = resolution || undefined;
        baseBody.numInferenceSteps = steps ? Math.round(steps) : undefined;
        baseBody.seed = seed !== null ? Math.round(seed) : null;
        if (imageUrl) baseBody.imageUrl = imageUrl;
      }
      return prepareImageModelRequests({
        models: [targetModel],
        baseBody,
        prompt,
        negativePrompt: negativePrompt || undefined,
      })[0];
    });
    const imageRequestByModel = new Map(
      imageRequests.map((request) => [request.model, request])
    );
    const invokeImageModel = async (
      targetModel: string,
      state: { attempt: number; maxAttempts: number }
    ) => {
      const request = imageRequestByModel.get(targetModel);
      if (!request) {
        throw new Error(`Image model ${targetModel} is not prepared.`);
      }
      const targetProvider = imageProviderByModelId.get(targetModel) ?? provider;
      const endpoint = imageEndpointForProvider(targetProvider);
      const imageApiKey = imageApiKeyForProvider(targetProvider);
      if (
        !imageApiKey &&
        !(targetProvider === "multillm" && allowServerApiKey)
      ) {
        throw new Error(`Missing ${imageProviderLabel(targetProvider)} API key for image tool.`);
      }
      const executeRequest = async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-api-key": imageApiKey,
          },
          body: JSON.stringify(request.body),
          signal,
        });
        let payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Image tool failed.");
        }

        if (
          (targetProvider === "navy" ||
            targetProvider === "multillm") &&
          typeof payload?.id === "string" &&
          payload.id
        ) {
          let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
          let didComplete = false;
          const source =
            targetModel.startsWith("nanogpt:") ? "nanogpt" : "navyai";
          for (let attempt = 0; attempt < NAVY_JOB_POLL_MAX_ATTEMPTS && !didComplete; attempt += 1) {
            const pollUrl =
              targetProvider === "multillm"
                ? `/api/multillm/image?id=${encodeURIComponent(payload.id)}&source=${source}`
                : `/api/navy/image?id=${encodeURIComponent(payload.id)}`;
            const pollResponse = await fetch(
              pollUrl,
              {
                headers: {
                  "x-user-api-key": imageApiKey,
                },
                signal,
              }
            );
            const pollPayload = await pollResponse.json();
            if (!pollResponse.ok && pollResponse.status !== 429) {
              throw new Error(pollPayload?.error ?? "Unable to poll image job.");
            }
            if (pollPayload?.done) {
              if (typeof pollPayload?.error === "string" && pollPayload.error) {
                throw new Error(`Async image job failed: ${pollPayload.error}`);
              }
              payload = pollPayload;
              didComplete = true;
              break;
            }
            delayMs = resolveNavyJobPollDelayMs({
              payload: pollPayload,
              responseStatus: pollResponse.status,
              currentDelayMs: delayMs,
            });
            await abortableDelay(delayMs, signal);
          }
          if (!didComplete) {
            throw new Error("Timed out waiting for the Navy image job.");
          }
        }

        const images = Array.isArray(payload?.images)
          ? (payload.images as Array<{
              data?: unknown;
              b64_json?: unknown;
              mimeType?: unknown;
              mime_type?: unknown;
              url?: unknown;
            }>)
          : [];
        if (!images.length) {
          throw new Error("No images returned by tool.");
        }
        const parsedImages = (
          await Promise.all(
            images.map(async (image): Promise<ChatImageAsset | null> => {
              const data =
                typeof image?.data === "string" && image.data
                  ? image.data
                  : typeof image?.b64_json === "string" && image.b64_json
                    ? image.b64_json
                    : "";
              const mimeType =
                typeof image?.mimeType === "string"
                  ? image.mimeType
                  : typeof image?.mime_type === "string"
                    ? image.mime_type
                    : "image/png";
              if (data) {
                return {
                  id: createId(),
                  dataUrl: dataUrlFromBase64(data, mimeType),
                  mimeType,
                  model: targetModel,
                  provider: targetProvider,
                };
              }
              if (typeof image?.url === "string") {
                const dataUrl = await fetchAsDataUrl(image.url);
                return {
                  id: createId(),
                  dataUrl,
                  mimeType,
                  model: targetModel,
                  provider: targetProvider,
                };
              }
              return null;
            })
          )
        ).filter(
          (
            item
          ): item is ChatImageAsset =>
            !!item
        );
        if (!parsedImages.length) {
          throw new Error("No usable images returned by tool.");
        }
        return parsedImages;
      };

      try {
        return await executeRequest();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image tool failed.";
        const currentPrompt =
          typeof request.body.prompt === "string" ? request.body.prompt : prompt;
        const shouldRecoverPrompt =
          state.attempt < state.maxAttempts && isLikelyImagePolicyError(message);
        if (!shouldRecoverPrompt) {
          throw error;
        }

        onModelProgress?.({
          model: targetModel,
          status: "rewriting",
          attempt: state.attempt + 1,
          maxAttempts: state.maxAttempts,
          prompt: currentPrompt,
          error: message,
        });
        const retryPrompt = await recoverImagePromptAfterPolicyFailure({
          targetModel,
          currentPrompt,
          errorMessage: message,
          nextAttempt: state.attempt + 1,
          maxAttempts: state.maxAttempts,
          signal,
        });
        if (retryPrompt && retryPrompt !== currentPrompt) {
          request.prompt = retryPrompt;
          request.body.prompt = retryPrompt;
        }
        throw error;
      }
    };

    const normalizedRetryAttempts = normalizeImageRetryAttempts(imageRetryAttempts);
    const result = await runImageModelPipelineParallel({
      models: modelsToRun,
      maxAttempts: normalizedRetryAttempts,
      runModel: invokeImageModel,
      onUpdate: (update) => {
        const targetModel = update.model;
        const request = imageRequestByModel.get(targetModel);
        const promptForModel =
          typeof request?.body.prompt === "string" ? request.body.prompt : prompt;
        if (update.status === "running") {
          onModelProgress?.({
            model: targetModel,
            status: "running",
            attempt: update.attempt,
            maxAttempts: update.maxAttempts,
            prompt: promptForModel,
          });
          return;
        }
        if (update.status === "success") {
          onModelProgress?.({
            model: targetModel,
            status: "success",
            attempt: update.attempt,
            maxAttempts: update.maxAttempts,
            prompt: promptForModel,
            images: update.value,
          });
          return;
        }

        if (update.status === "error") {
          const message =
            update.error instanceof Error
              ? update.error.message
              : "Image generation failed.";
          onModelProgress?.({
            model: targetModel,
            status: "error",
            attempt: update.attempt,
            maxAttempts: update.maxAttempts,
            prompt: promptForModel,
            error: message,
          });
        }
      },
    });
    const parsedImages =
      result.status === "fulfilled"
        ? result.values.flatMap((entry) => entry.value)
        : [];
    const errors = result.errors.map(({ model, reason, attempts }) => {
      const message =
        reason instanceof Error
          ? reason.message
          : "Image generation failed.";
      return `${model}: ${message} after ${attempts} ${attempts === 1 ? "try" : "tries"}`;
    });

    if (!parsedImages.length) {
      throw new Error(errors.join(" | ") || "No usable images returned by tool.");
    }

    const successfulModels =
      result.status === "fulfilled"
        ? result.values.map((entry) => entry.model)
        : [];

    return {
      images: parsedImages,
      model: successfulModels.length ? successfulModels.join(", ") : modelsToRun.join(", "),
      prompt: summarizeImageModelPrompts(imageRequests),
      errors,
    };
  };

  const runGenerateVideo = async (
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => {
    const prompt = getStringArg(args, ["prompt"]);
    if (!prompt) {
      throw new Error("Tool call missing prompt.");
    }
    const modelOverride = getStringArg(args, ["model"]) || toolVideoModel;
    const targetModel = videoModelById.get(modelOverride);
    if (!targetModel || !isChatVideoModelSupported(targetModel)) {
      throw new Error(`Video model ${modelOverride || "(none)"} is not available to chat.`);
    }
    const targetProvider = videoProviderByModelId.get(modelOverride) ?? provider;
    const targetApiKey = videoApiKeyForProvider(targetProvider);
    if (
      !targetApiKey &&
      !(targetProvider === "multillm" && allowServerApiKey)
    ) {
      throw new Error(`Missing ${imageProviderLabel(targetProvider)} API key for video tool.`);
    }
    const sourceImage =
      getStringArg(args, ["image_url", "image"]) ||
      latestGeneratedImageRef.current ||
      videoImage ||
      "";

    if (targetProvider === "multillm") {
      const source = modelOverride.startsWith("nanogpt:")
        ? "nanogpt"
        : "navyai";
      const size = getStringArg(args, ["size", "resolution"]);
      const aspectRatio =
        getStringArg(args, ["aspect_ratio", "aspectRatio"]) ||
        videoAspect;
      const seconds =
        getNumberArg(args, ["seconds", "duration"]) ??
        (videoDuration ? Number(videoDuration) : undefined);
      const createResponse = await fetch("/api/multillm/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({
          model: modelOverride,
          prompt,
          sourceImage: sourceImage || undefined,
          size: size || undefined,
          resolution: size || undefined,
          aspectRatio: aspectRatio || undefined,
          seconds,
        }),
        signal,
      });
      const contentType = createResponse.headers.get("content-type") ?? "";
      if (contentType.startsWith("video/")) {
        if (!createResponse.ok) {
          throw new Error("MultiLLM video generation failed.");
        }
        const blob = await createResponse.blob();
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
      }

      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(
          createPayload?.error ?? "Unable to start MultiLLM video generation."
        );
      }
      let videoUrl =
        typeof createPayload?.videoUrl === "string"
          ? createPayload.videoUrl
          : "";
      const jobId =
        typeof createPayload?.id === "string" ? createPayload.id : "";
      if (!videoUrl && !jobId) {
        throw new Error("No MultiLLM video result or job id returned.");
      }

      for (
        let attempt = 0;
        !videoUrl &&
        attempt < NAVY_JOB_POLL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const pollResponse = await fetch(
          `/api/multillm/video?id=${encodeURIComponent(jobId)}&source=${source}`,
          {
            headers: {
              "x-user-api-key": targetApiKey,
            },
            signal,
          }
        );
        const pollPayload = await pollResponse.json();
        if (!pollResponse.ok) {
          throw new Error(
            pollPayload?.error ?? "Unable to check MultiLLM video status."
          );
        }
        if (pollPayload?.done) {
          if (
            typeof pollPayload?.error === "string" &&
            pollPayload.error
          ) {
            throw new Error(pollPayload.error);
          }
          if (
            typeof pollPayload?.videoUrl === "string" &&
            pollPayload.videoUrl
          ) {
            videoUrl = pollPayload.videoUrl;
          }
          break;
        }
        const delayMs = resolveNavyJobPollDelayMs({
          payload: pollPayload,
          responseStatus: pollResponse.status,
          currentDelayMs: NAVY_JOB_POLL_INTERVAL_MS,
        });
        await abortableDelay(delayMs, signal);
      }
      if (!videoUrl) {
        throw new Error(
          "MultiLLM video generation timed out before a result was available."
        );
      }

      if (jobId) {
        const downloadResponse = await fetch(
          "/api/multillm/video/download",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-api-key": targetApiKey,
            },
            body: JSON.stringify({ id: jobId, source }),
            signal,
          }
        );
        if (!downloadResponse.ok) {
          const payload = await downloadResponse.json().catch(() => null);
          throw new Error(
            payload?.error ?? "Unable to download MultiLLM video."
          );
        }
        const blob = await downloadResponse.blob();
        const mimeType = blob.type || "video/mp4";
        videoUrl = await blobToDataUrl(blob);
        return {
          media: [
            {
              id: createId(),
              kind: "video" as const,
              dataUrl: videoUrl,
              mimeType,
            },
          ],
          model: modelOverride,
          prompt,
        };
      }

      return {
        media: [
          {
            id: createId(),
            kind: "video" as const,
            dataUrl: videoUrl,
            mimeType: "video/mp4",
          },
        ],
        model: modelOverride,
        prompt,
      };
    }

    if (targetProvider === "navy") {
      const size = getStringArg(args, ["size"]);
      const seconds = getNumberArg(args, ["seconds"]);
      const seed = getNumberArg(args, ["seed"]);
      const createResponse = await fetch("/api/navy/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({
          model: modelOverride,
          prompt,
          size: size || undefined,
          imageUrl: sourceImage || undefined,
          seconds: seconds ?? undefined,
          seed: seed ?? undefined,
        }),
        signal,
      });
      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createPayload?.error ?? "Unable to start video generation.");
      }

      const startResult = resolveNavyVideoStartResult(createPayload);
      const jobId = startResult.jobId;
      let videoUrl = startResult.videoUrl;
      if (!videoUrl && !jobId) {
        throw new Error("No video result or job id returned by provider.");
      }

      for (
        let attempt = 0;
        !videoUrl && attempt < NAVY_JOB_POLL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const pollResponse = await fetch(
          `/api/navy/video?id=${encodeURIComponent(jobId)}`,
          {
            headers: {
              "x-user-api-key": targetApiKey,
            },
            signal,
          }
        );
        const pollPayload = await pollResponse.json();
        if (!pollResponse.ok) {
          throw new Error(
            pollPayload?.error ?? "Unable to check video generation status."
          );
        }
        if (!pollPayload?.done) {
          const delayMs = resolveNavyJobPollDelayMs({
            payload: pollPayload,
            responseStatus: pollResponse.status,
            currentDelayMs: NAVY_JOB_POLL_INTERVAL_MS,
          });
          await abortableDelay(delayMs, signal);
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
      const downloadResponse = await fetch("/api/navy/video/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({ url: videoUrl }),
        signal,
      });
      if (!downloadResponse.ok) {
        let message = "Unable to download generated video.";
        try {
          const payload = await downloadResponse.json();
          if (typeof payload?.error === "string" && payload.error) {
            message = payload.error;
          }
        } catch {
          // Keep the concise fallback when the route returns a non-JSON error.
        }
        throw new Error(message);
      }
      const blob = await downloadResponse.blob();
      const resolvedMimeType = blob.type || "video/mp4";
      const resolvedVideoUrl = await blobToDataUrl(blob);
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

    if (targetProvider === "nanogpt") {
      const requiresSourceImage =
        targetModel.supports?.imageToVideo === true &&
        targetModel.supports.textToVideo === false;
      if (requiresSourceImage && !sourceImage) {
        throw new Error(`${targetModel.label} requires a source image.`);
      }
      const createResponse = await fetch("/api/nanogpt/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify(
          buildNanoGptVideoToolRequest({
            model: targetModel,
            prompt,
            sourceImage,
            args,
          })
        ),
        signal,
      });
      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createPayload?.error ?? "Unable to start NanoGPT video generation.");
      }
      const jobId =
        typeof createPayload?.id === "string"
          ? createPayload.id
          : typeof createPayload?.runId === "string"
            ? createPayload.runId
            : "";
      if (!jobId) {
        throw new Error("No NanoGPT video job id returned.");
      }

      let completed = false;
      let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
      for (
        let attempt = 0;
        !completed && attempt < NAVY_JOB_POLL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        await abortableDelay(delayMs, signal);
        const pollResponse = await fetch(
          `/api/nanogpt/video?id=${encodeURIComponent(jobId)}`,
          {
            headers: { "x-user-api-key": targetApiKey },
            signal,
          }
        );
        const pollPayload = await pollResponse.json();
        if (!pollResponse.ok) {
          throw new Error(pollPayload?.error ?? "Unable to check NanoGPT video status.");
        }
        completed = pollPayload?.done === true;
        if (!completed) {
          delayMs = resolveNavyJobPollDelayMs({
            payload: pollPayload,
            responseStatus: pollResponse.status,
            currentDelayMs: delayMs,
          });
        }
      }
      if (!completed) {
        throw new Error("NanoGPT video generation timed out before completion.");
      }

      const downloadResponse = await fetch("/api/nanogpt/video/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({ id: jobId }),
        signal,
      });
      if (!downloadResponse.ok) {
        let message = "Unable to download generated NanoGPT video.";
        try {
          const payload = await downloadResponse.json();
          if (typeof payload?.error === "string" && payload.error) {
            message = payload.error;
          }
        } catch {
          // Keep the concise fallback when the route returns a non-JSON error.
        }
        throw new Error(message);
      }
      const blob = await downloadResponse.blob();
      const mimeType = blob.type || "video/mp4";
      return {
        media: [
          {
            id: createId(),
            kind: "video" as const,
            dataUrl: await blobToDataUrl(blob),
            mimeType,
            model: modelOverride,
          },
        ],
        model: modelOverride,
        prompt,
      };
    }

    if (!sourceImage) {
      throw new Error("Chutes video generation requires an image URL or data URI.");
    }
    const fps = getNumberArg(args, ["fps"]);
    const guidanceScale = getNumberArg(args, ["guidance_scale_2"]);
    const response = await fetch("/api/chutes/video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": targetApiKey,
      },
      body: JSON.stringify({
        prompt,
        model: modelOverride,
        image: sourceImage,
        fps: fps ?? undefined,
        guidance_scale_2: guidanceScale ?? undefined,
      }),
      signal,
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

  const runGenerateAudio = async (
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => {
    if (!apiKey.trim() && !allowServerApiKey) {
      throw new Error("Missing API key for audio tool.");
    }
    const prompt = getStringArg(args, ["input", "text", "prompt"]);
    if (!prompt) {
      throw new Error("Tool call missing input text.");
    }
    const modelOverride = getStringArg(args, ["model"]) || toolAudioModel;

    if (provider === "multillm") {
      const speed = getNumberArg(args, ["speed"]);
      const voice = getStringArg(args, ["voice"]) || "alloy";
      const responseFormat = getStringArg(args, ["response_format"]);
      const response = await fetch("/api/multillm/audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": apiKey,
        },
        body: JSON.stringify({
          model: modelOverride,
          input: prompt,
          voice,
          speed: speed ?? undefined,
          responseFormat: responseFormat || undefined,
        }),
        signal,
      });
      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = await response.json();
          throw new Error(payload?.error ?? "Audio tool failed.");
        }
        throw new Error((await response.text()) || "Audio tool failed.");
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
    }

    if (provider === "navy") {
      const speed = getNumberArg(args, ["speed"]);
      const voice = getStringArg(args, ["voice"]) || "alloy";
      const responseFormat = getStringArg(args, ["response_format"]);
      const response = await fetch("/api/navy/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": apiKey,
        },
        body: JSON.stringify({
          model: modelOverride,
          input: prompt,
          voice,
          speed: speed ?? undefined,
          responseFormat: responseFormat || undefined,
        }),
        signal,
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
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        model: modelOverride,
        speed: speed ?? undefined,
        speaker: speaker ?? undefined,
        maxDuration: maxDuration ?? undefined,
      }),
      signal,
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

  const readChatAttachment = async (file: File): Promise<ChatAttachmentAsset> => {
    if (file.type.startsWith("image/")) {
      if (!supportsImageAttachments) {
        throw new Error("The selected chat model does not advertise image input support.");
      }
      if (file.size > CHAT_IMAGE_ATTACHMENT_MAX_BYTES) {
        throw new Error("Image attachment is larger than 8 MB.");
      }
      return {
        id: createId(),
        kind: "image",
        name: file.name,
        mimeType: file.type || "image/png",
        size: file.size,
        dataUrl: await fileToDataUrl(file),
      };
    }

    if (isSupportedPdfFile(file)) {
      if (!supportsFileAttachments) {
        throw new Error("The selected chat model does not advertise file/PDF input support.");
      }
      const result = await extractPdfTextFromFile(file, {
        maxChars: CHAT_TEXT_ATTACHMENT_MAX_CHARS,
      });
      return {
        id: createId(),
        kind: "pdf",
        name: result.fileName,
        mimeType: file.type || "application/pdf",
        size: file.size,
        text: result.text,
        pagesRead: result.pagesRead,
        totalPages: result.totalPages,
        truncated: result.truncatedByChars || result.truncatedByPages,
      };
    }

    if (acceptsTextFile(file)) {
      if (!supportsFileAttachments) {
        throw new Error("The selected chat model does not advertise file/text input support.");
      }
      if (file.size > CHAT_TEXT_ATTACHMENT_MAX_BYTES) {
        throw new Error("Text attachment is larger than 2 MB.");
      }
      const rawText = await file.text();
      const truncated = rawText.length > CHAT_TEXT_ATTACHMENT_MAX_CHARS;
      return {
        id: createId(),
        kind: "text",
        name: file.name,
        mimeType: file.type || "text/plain",
        size: file.size,
        text: (truncated ? rawText.slice(0, CHAT_TEXT_ATTACHMENT_MAX_CHARS) : rawText).trim(),
        truncated,
      };
    }

    throw new Error(`Unsupported attachment type for ${file.name}.`);
  };

  const addAttachmentFiles = async (files: FileList | File[]) => {
    const candidates = Array.from(files).slice(
      0,
      Math.max(0, MAX_PENDING_ATTACHMENTS - pendingAttachments.length)
    );
    if (!candidates.length) return;

    setAttachmentLoading(true);
    setAttachmentError(null);
    try {
      const nextAttachments = await Promise.all(candidates.map(readChatAttachment));
      setPendingAttachments((prev) => [
        ...prev,
        ...nextAttachments,
      ].slice(0, MAX_PENDING_ATTACHMENTS));
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Unable to attach file."
      );
    } finally {
      setAttachmentLoading(false);
    }
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  };

  const copyEmbedMarkdown = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPromptMessageId("embed-markdown");
      window.setTimeout(
        () => setCopiedPromptMessageId((prev) => (prev === "embed-markdown" ? null : prev)),
        1500
      );
    } catch {
      setAttachmentError("Unable to copy embed markdown.");
    }
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

  const openMediaPreview = useCallback(
    (item: ChatMediaAsset, prompt: string) => {
      setActiveMediaPreview(
        buildChatMediaPreview({
          item,
          prompt,
          provider: providerLabel,
        })
      );
    },
    [providerLabel]
  );

  const openAttachmentPreview = useCallback(
    (attachment: ChatAttachmentAsset, prompt: string) => {
      if (attachment.kind !== "image" || !attachment.dataUrl) return;
      openMediaPreview(
        {
          id: attachment.id,
          kind: "image",
          dataUrl: attachment.dataUrl,
          mimeType: attachment.mimeType,
        },
        prompt
      );
    },
    [openMediaPreview]
  );

  const closeMediaPreview = useCallback((open: boolean) => {
    if (!open) {
      setActiveMediaPreview(null);
    }
  }, []);

  const downloadChatMedia = useCallback((item: ChatMediaAsset) => {
    const link = document.createElement("a");
    link.href = item.dataUrl;
    link.download = `generation-${item.id}.${mediaExtensionFromMimeType(
      item.mimeType,
      item.kind
    )}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleToolCalls = async (
    toolCalls: ToolCall[],
    onProgress?: (message: ChatMessage) => void,
    context?: { assistantContent: string; userPrompt: string },
    signal?: AbortSignal
  ) => {
    const toolMessages: ChatMessage[] = [];
    const orderedToolCalls = [
      ...toolCalls.filter(
        (toolCall) => toolCall.function?.name !== "generate_video"
      ),
      ...toolCalls.filter(
        (toolCall) => toolCall.function?.name === "generate_video"
      ),
    ];
    for (const toolCall of orderedToolCalls) {
      const toolName = toolCall.function?.name ?? "";
      let args: Record<string, unknown> = {};

      if (toolCall.input_error) {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: `Tool error: Invalid tool arguments. ${toolCall.input_error}`,
          toolCallId: toolCall.id,
          name: toolName || undefined,
        });
        continue;
      }

      try {
        args = resolveToolArguments({
          toolName,
          rawArgs: toolCall.function?.arguments ?? "",
          context,
        }).args;
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

      if (toolName === "generate_image" && context) {
        args = repairImageToolArguments(args, context);
      }
      const invocationPrompt = getStringArg(args, ["prompt", "input", "text"]);

      const disabledByUser =
        (toolName === "generate_image" && (!toolSettings.image || !imageModels.length)) ||
        (toolName === "generate_video" && (!toolSettings.video || !videoModels.length)) ||
        (toolName === "generate_audio" && (!toolSettings.audio || !audioModels.length));
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
            id: `${toolCall.id}:invoking`,
            role: "tool",
            content: `Invoking ${toolName}...`,
            promptUsed: invocationPrompt || undefined,
            toolCallId: toolCall.id,
            name: toolName,
            transient: true,
          });
        }

        if (toolName === "generate_image") {
          const result = await runGenerateImage(args, context, (update) => {
            const imageCount = update.images?.length ?? 0;
            const attemptLabel =
              update.maxAttempts && update.maxAttempts > 1 && update.attempt
                ? ` (try ${update.attempt}/${update.maxAttempts})`
                : "";
            const content =
              update.status === "running"
                ? `Generating image with ${update.model}${attemptLabel}...`
                : update.status === "rewriting"
                  ? `Rephrasing prompt for ${update.model}${attemptLabel} after safety rejection...`
                  : update.status === "success"
                    ? `Generated ${imageCount} image${imageCount === 1 ? "" : "s"} with ${update.model}.`
                    : `Image generation failed with ${update.model}${attemptLabel}: ${update.error ?? "Unknown error."}`;
            onProgress?.({
              id: `${toolCall.id}:image:${update.model}`,
              role: "tool",
              content,
              promptUsed: update.prompt || undefined,
              toolCallId: toolCall.id,
              name: toolName,
              images: update.images,
              media: update.images?.map((image) => ({
                ...image,
                kind: "image" as const,
              })),
              transient: true,
            });
          }, signal);
          latestGeneratedImageRef.current =
            result.images[0]?.dataUrl ?? latestGeneratedImageRef.current;
          if (saveToGallery && onSaveImages) {
            const imagesByProvider = new Map<Provider, ChatImageAsset[]>();
            for (const image of result.images) {
              const targetProvider = image.provider ?? provider;
              imagesByProvider.set(targetProvider, [
                ...(imagesByProvider.get(targetProvider) ?? []),
                image,
              ]);
            }
            for (const [targetProvider, images] of imagesByProvider) {
              await onSaveImages({
                images,
                prompt: result.prompt,
                model: Array.from(
                  new Set(images.map((image) => image.model).filter(Boolean))
                ).join(", ") || result.model,
                provider: targetProvider,
              });
            }
          }
          refreshNavyUsageAfterMediaTool();
          const imageStatus = result.errors.length
            ? `Generated ${result.images.length} image(s) using ${result.model}. Failed: ${result.errors.join("; ")}`
            : `Generated ${result.images.length} image(s) using ${result.model}.`;
          toolMessages.push({
            id: createId(),
            role: "tool",
            content: imageStatus,
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
          const result = await runGenerateVideo(args, signal);
          refreshNavyUsageAfterMediaTool();
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
          const result = await runGenerateAudio(args, signal);
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
        if (isAbortLikeError(error, signal)) {
          const completedToolCallIds = toolMessages
            .map((message) => message.toolCallId)
            .filter((id): id is string => Boolean(id));
          toolMessages.push(
            ...buildCancelledToolResults(
              orderedToolCalls,
              completedToolCallIds
            ).map((result) => ({
              id: createId(),
              role: "tool" as const,
              ...result,
            }))
          );
          return toolMessages;
        }
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

  const runChatTurn = async (
    trimmed: string,
    attachments: ChatAttachmentAsset[] = [],
    submittedTurnIntent: ChatTurnIntent = "auto"
  ) => {
    if (!hasApiAccess) {
      setChatError(`Add your ${providerLabel} API key in settings.`);
      const nextQueuedTurn = takeNextQueuedTurn();
      if (nextQueuedTurn) {
        void runChatTurn(
          nextQueuedTurn.content,
          nextQueuedTurn.attachments,
          nextQueuedTurn.turnIntent
        );
      } else {
        setChatBusy(false);
      }
      return;
    }
    if (!model) {
      setChatError("Select a chat model.");
      const nextQueuedTurn = takeNextQueuedTurn();
      if (nextQueuedTurn) {
        void runChatTurn(
          nextQueuedTurn.content,
          nextQueuedTurn.attachments,
          nextQueuedTurn.turnIntent
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
      id: createId(),
      role: "user",
      content: trimmed || "Please analyze the attached file(s).",
      attachments,
      turnIntent: submittedTurnIntent,
    };

    // Optimistic update
    let currentMessages: ChatMessage[] = [...messagesRef.current, userMessage];
    commitMessages(currentMessages);
    const turnDecision = resolveChatTurnIntent(
      trimmed,
      toolAvailability,
      submittedTurnIntent
    );
    const turnToolPolicy = resolveChatTurnToolPolicy(turnDecision);
    const forcedToolCall = turnToolPolicy.forcedToolCall;
    let toolRounds = 0;

    try {
      for (let step = 0; step < MAX_CHAT_MODEL_STEPS; step += 1) {
        const allowTools =
          toolRounds < MAX_CHAT_TOOL_ROUNDS &&
          turnToolPolicy.activeTools?.length !== 0;
        // Create placeholder assistant message
        const assistantId = createId();
        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
        };

        // Add to state immediately
        currentMessages = [...currentMessages, assistantMessage];
        commitMessages(currentMessages);

        // Stream content into this message
        const finalResult = await callChatStreaming(
          currentMessages.slice(0, -1), // Send history excluding the placeholder
          (update) => {
            currentMessages = currentMessages.map((msg) => {
              if (msg.id === assistantId) {
                return {
                  ...msg,
                  content: update.content ?? msg.content,
                  thinking: update.thinking ?? msg.thinking,
                  toolCalls: update.toolCalls ?? msg.toolCalls,
                };
              }
              return msg;
            });
            commitMessages(currentMessages);
          },
          step === 0 && forcedToolCall && allowTools
            ? { type: "function", function: { name: forcedToolCall } }
            : undefined,
          {
            allowTools,
            activeTools: turnToolPolicy.activeTools,
            signal: abortController.signal,
          }
        );

        // After stream is done, final update to ensure consistency (and clean up any missing fields)
        const finalToolCalls = finalResult.toolCalls.filter(tc => tc.id && tc.function.name);
        const assistantToolContext = buildAssistantToolContextContent({
          content: finalResult.content,
          thinking: finalResult.thinking,
        });

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
        commitMessages(currentMessages);
        const applyProgressMessage = (message: ChatMessage) => {
          currentMessages = currentMessages.some((item) => item.id === message.id)
            ? currentMessages.map((item) => item.id === message.id ? message : item)
            : [...currentMessages, message];
          commitMessages(currentMessages);
        };
        const removeProgressMessages = (completedToolCalls: ToolCall[]) => {
          const completedToolCallIds = new Set(
            completedToolCalls.map((toolCall) => toolCall.id).filter(Boolean)
          );
          if (!completedToolCallIds.size) return;
          currentMessages = currentMessages.filter(
            (message) =>
              !(
                message.transient &&
                message.toolCallId &&
                completedToolCallIds.has(message.toolCallId)
              )
          );
          commitMessages(currentMessages);
        };

        // Check for tool calls
        if (!finalToolCalls.length) {
          if (
            step === 0 &&
            forcedToolCall &&
            turnToolPolicy.allowSyntheticFallback
          ) {
            const fallbackToolCall = createSyntheticFallbackToolCall({
              requestedTool: forcedToolCall,
              provider,
              userPrompt: trimmed,
              assistantContent: assistantToolContext,
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
                id: createId(),
                type: "function",
                function: {
                  name: fallbackToolCall.name,
                  arguments: JSON.stringify(fallbackToolCall.arguments),
                },
              };
              const assistantWithSyntheticToolCall: ChatMessage = {
                ...finalizedAssistantMessage,
                toolCalls: [syntheticToolCall],
              };
              currentMessages = [
                ...currentMessages.slice(0, -1),
                assistantWithSyntheticToolCall,
              ];
              commitMessages(currentMessages);
              const toolMessages = await handleToolCalls(
                [syntheticToolCall],
                applyProgressMessage,
                { assistantContent: assistantToolContext, userPrompt: trimmed },
                abortController.signal
              );
              if (toolMessages.length) {
                removeProgressMessages([syntheticToolCall]);
                currentMessages = [...currentMessages, ...toolMessages];
                commitMessages(currentMessages);
                toolRounds += 1;
                continue;
              }
            }
          }
          break;
        }

        // Run tools
        const toolMessages = await handleToolCalls(
          finalToolCalls,
          applyProgressMessage,
          { assistantContent: assistantToolContext, userPrompt: trimmed },
          abortController.signal
        );
        removeProgressMessages(finalToolCalls);
        currentMessages = [...currentMessages, ...toolMessages];
        commitMessages(currentMessages);
        toolRounds += 1;
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        setChatError(
          error instanceof Error ? error.message : "Unable to run chat."
        );
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      const nextQueuedTurn = takeNextQueuedTurn();
      if (nextQueuedTurn) {
        void runChatTurn(
          nextQueuedTurn.content,
          nextQueuedTurn.attachments,
          nextQueuedTurn.turnIntent
        );
      } else {
        setChatBusy(false);
      }
    }
  };

  const stopChat = () => {
    updateQueuedTurns([]);
    chatAbortControllerRef.current?.abort();
  };

  const submitMessage = () => {
    const trimmed = input.trim();
    const attachmentsToSend = pendingAttachments;
    if (!trimmed && !attachmentsToSend.length) return;
    if (!hasApiAccess) {
      setChatError(`Add your ${providerLabel} API key in settings.`);
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

    if (busyRef.current || queuedTurnsRef.current.length) {
      enqueueChatTurn(trimmed, attachmentsToSend, currentTurnDecision.intent);
      return;
    }

    void runChatTurn(trimmed, attachmentsToSend, currentTurnDecision.intent);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const clearChat = () => {
    commitMessages([]);
    updateQueuedTurns([]);
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

  const embedBaseUrl = embedOrigin || "https://your-domain.example";
  const chatEmbedUrl = `${embedBaseUrl}/?view=chat&embed=1`;
  const fullscreenChatEmbedUrl = `${chatEmbedUrl}&fullscreen=1`;
  const studioEmbedUrl = `${embedBaseUrl}/?view=image&embed=1`;
  const embedMarkdown = [
    '<iframe',
    `  src="${chatEmbedUrl}"`,
    '  title="Studio chat"',
    '  loading="lazy"',
    '  allow="clipboard-read; clipboard-write; fullscreen"',
    '  style="width:100%; min-height:720px; border:0; border-radius:12px;"',
    "></iframe>",
  ].join("\n");

  return (
    <>
    <div
      className={cn(
        "flex flex-col bg-background/50 isolate",
        fullscreen
          ? "fixed inset-0 z-50 h-[100dvh] w-screen"
          : "h-full"
      )}
    >
      {/* Header */}
      <header className="glass sticky top-0 z-10 flex-none border-b p-2.5 sm:p-4">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:hidden">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold leading-none">
                {providerHeading}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Online
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-2 rounded-xl bg-primary/10 text-primary"
            >
              <Bot className="h-6 w-6" />
            </motion.div>
            <div>
              <h2 className="font-semibold text-lg leading-none">
                {providerHeading}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Online
              </p>
            </div>
          </div>

          <div className="grid w-full grid-cols-[minmax(6.75rem,0.8fr)_minmax(0,1.2fr)] items-center gap-1.5 sm:flex sm:w-auto sm:flex-nowrap sm:justify-end sm:overflow-visible sm:pb-0">
            <Select value={provider} onValueChange={(value) => setProvider(value as ChatProvider)}>
              <SelectTrigger className="glass-card h-9 min-w-0 flex-none border-0 bg-secondary/50 sm:w-[140px]">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {CHAT_PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ModelSearchSelect
              value={model}
              onValueChange={setModel}
              models={models}
              staticModelIds={staticModelIds.chat}
              placeholder="Select a model"
              title="Chat Model"
              ariaLabel="Chat Model"
              triggerClassName="sm:w-[240px]"
            />

            <div className="no-scrollbar col-span-2 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1 sm:contents sm:overflow-visible sm:pb-0">
            {chatModelSupportsReasoning ? (
              <Select
                value={reasoningEffort}
                onValueChange={(value) =>
                  setReasoningEffort(isReasoningEffort(value) ? value : "high")
                }
              >
                <SelectTrigger
                  className="glass-card h-9 w-[112px] flex-none border-0 bg-secondary/50"
                  title="Reasoning Effort"
                  aria-label="Reasoning Effort"
                >
                  <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONING_EFFORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <ModelSearchSelect
              value={toolImageModel}
              onValueChange={setToolImageModel}
              models={imageModels}
              staticModelIds={staticModelIds.image}
              placeholder="Select image model"
              title="Image Tool Model"
              ariaLabel="Image Tool Model"
              disabled={!toolSettings.image || !imageModels.length}
              icon={<ImageIcon className="h-4 w-4" />}
              compact
              footer={navyToolUsageFooter}
            />

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 flex-none glass-card border-0 bg-secondary/50"
                  title="Image Tool Pipeline"
                  aria-label="Image Tool Pipeline"
                  disabled={!toolSettings.image || !imageModels.length}
                >
                  <Layers3 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Image Tool Pipeline</DialogTitle>
                  <DialogDescription>
                    Reuse the shared image pipeline from Image Gen for chat image requests.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <label className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-secondary/20 p-3">
                    <div>
                      <div className="text-sm font-medium">Enable ordered pipeline</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        When enabled, chat image generation runs selected models in parallel. If the tool
                        chooses a model, that model is ordered first.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={imagePipelineEnabled}
                      onChange={(event) => setImagePipelineEnabled(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  </label>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Tries per model</div>
                    <Select
                      value={imageRetryAttempts.toString()}
                      onValueChange={(value) => setImageRetryAttempts(parseInt(value))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4].map((attempts) => (
                          <SelectItem key={attempts} value={attempts.toString()}>
                            {attempts}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    {imageModels.map((suggestion) => {
                      const index = orderedToolImageModels.indexOf(suggestion.id);
                      const selected = index !== -1;
                      return (
                        <div
                          key={suggestion.id}
                          className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-2 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => togglePipelineModel(suggestion.id)}
                            className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/60 bg-background text-muted-foreground"
                            }`}
                            aria-label={`${selected ? "Remove" : "Add"} ${suggestion.label} from pipeline`}
                          >
                            {selected ? <Check className="h-4 w-4" /> : <span className="text-xs">+</span>}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{suggestion.label}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{suggestion.id}</div>
                          </div>
                          {selected ? (
                            <>
                              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                                #{index + 1}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => reorderPipelineModel(suggestion.id, "up")}
                                  disabled={index === 0}
                                >
                                  <ChevronUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => reorderPipelineModel(suggestion.id, "down")}
                                  disabled={index === orderedToolImageModels.length - 1}
                                >
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {imagePipelineEnabled
                      ? orderedToolImageModels.length
                        ? `Chat will run ${orderedToolImageModels.length} image model${orderedToolImageModels.length === 1 ? "" : "s"} in parallel with ${imageRetryAttempts} tries each.`
                        : "No extra models selected yet. Chat falls back to the default image model."
                      : "Pipeline is disabled. Chat uses the single selected image model only."}
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            <ModelSearchSelect
              value={toolVideoModel}
              onValueChange={setToolVideoModel}
              models={videoModels}
              staticModelIds={staticModelIds.video}
              placeholder="Select video model"
              title="Video Tool Model"
              ariaLabel="Video Tool Model"
              disabled={!toolSettings.video || !videoModels.length}
              icon={<Video className="h-4 w-4" />}
              compact
              footer={navyToolUsageFooter}
            />

            {provider === "navy" && (toolSettings.image || toolSettings.video) ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onRefreshUsage?.()}
                disabled={navyUsageLoading || !onRefreshUsage}
                className="glass-card h-9 flex-none border-0 bg-secondary/50 px-2 text-xs"
                title="Check NavyAI image and video usage"
                aria-label="Check NavyAI image and video usage"
              >
                <Gauge className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">
                  {navyUsage
                    ? `${formatCount(navyUsage.usage.tokens_remaining_today)} left`
                    : navyUsageError
                      ? "Usage error"
                      : "Usage"}
                </span>
              </Button>
            ) : null}

            <ModelSearchSelect
              value={toolAudioModel}
              onValueChange={setToolAudioModel}
              models={audioModels}
              staticModelIds={staticModelIds.audio}
              placeholder="Select audio model"
              title="Audio Tool Model"
              ariaLabel="Audio Tool Model"
              disabled={!toolSettings.audio || !audioModels.length}
              icon={<AudioLines className="h-4 w-4" />}
              compact
            />

            {onRefreshModels && (
              <Button variant="ghost" size="icon" onClick={onRefreshModels} disabled={modelsLoading} className="h-9 w-9 flex-none" title="Refresh models" aria-label="Refresh models">
                <Sparkles className={cn("h-4 w-4", modelsLoading && "animate-spin")} />
              </Button>
            )}

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 flex-none"
                  title="Model input details"
                  aria-label="Model input details"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Model modalities</DialogTitle>
                  <DialogDescription>
                    Upload controls follow the selected model metadata.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
                    <div className="text-sm font-semibold">{selectedChatModel?.label ?? model}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{model}</div>
                    {selectedChatModel?.description ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {selectedChatModel.description}
                      </p>
                    ) : null}
                  </div>
                  {selectedChatModel?.category ||
                  selectedChatModel?.contextWindow !== undefined ||
                  selectedChatModel?.maxOutputTokens !== undefined ||
                  selectedChatModel?.subscription ? (
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      {selectedChatModel.category ? (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                          Category: {selectedChatModel.category}
                        </div>
                      ) : null}
                      {selectedChatModel.contextWindow !== undefined ? (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                          Context: {formatModelWindow(selectedChatModel.contextWindow)} tokens
                        </div>
                      ) : null}
                      {selectedChatModel.maxOutputTokens !== undefined ? (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                          Max output: {formatModelWindow(selectedChatModel.maxOutputTokens)} tokens
                        </div>
                      ) : null}
                      {selectedChatModel.subscription ? (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                          <div>
                            Subscription: {selectedChatModel.subscription.included === true
                              ? "included"
                              : selectedChatModel.subscription.included === false
                                ? "paid extra"
                                : "provider-defined"}
                            {typeof selectedChatModel.subscription.inputTokenMultiplier === "number"
                              ? ` · ${selectedChatModel.subscription.inputTokenMultiplier}x input tokens`
                              : ""}
                          </div>
                          {selectedChatModel.subscription.note ? (
                            <p className="mt-1 text-muted-foreground">
                              {selectedChatModel.subscription.note}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedChatModel?.providers?.length ? (
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Available routes
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedChatModel.providers.map((item) => (
                          <span key={item} className="rounded-full bg-secondary px-2 py-1 text-xs">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inputs</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(inputModalities.length ? inputModalities : ["unknown"]).map((item) => (
                          <span key={item} className="rounded-full bg-secondary px-2 py-1 text-xs">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outputs</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(outputModalities.length ? outputModalities : ["unknown"]).map((item) => (
                          <span key={item} className="rounded-full bg-secondary px-2 py-1 text-xs">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      Image upload: {supportsImageAttachments ? "available" : "not advertised"}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      PDF/text upload: {supportsFileAttachments ? "available" : "not advertised"}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      Audio input: {supportsAudioInput ? "advertised" : "not advertised"}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                      Video input: {supportsVideoInput ? "advertised" : "not advertised"}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Image uploads are sent as multimodal image parts. PDF and text files are extracted locally and sent as text context for provider compatibility.
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={embedDialogOpen} onOpenChange={setEmbedDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 flex-none"
                  title="Embed chat"
                  aria-label="Embed chat"
                >
                  <Code2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Embed Studio chat</DialogTitle>
                  <DialogDescription>
                    Responsive iframe snippets for chat-only or generation views.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <a
                      href={chatEmbedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-border/60 bg-secondary/20 p-3 text-sm hover:bg-secondary/40"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        Chat embed <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                      <span className="mt-1 block break-all text-[11px] text-muted-foreground">
                        {chatEmbedUrl}
                      </span>
                    </a>
                    <a
                      href={fullscreenChatEmbedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-border/60 bg-secondary/20 p-3 text-sm hover:bg-secondary/40"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        Fullscreen chat <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                      <span className="mt-1 block break-all text-[11px] text-muted-foreground">
                        {fullscreenChatEmbedUrl}
                      </span>
                    </a>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Markdown / HTML
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copyEmbedMarkdown(embedMarkdown)}
                        className="h-7 px-2 text-xs"
                      >
                        {copiedPromptMessageId === "embed-markdown" ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs">
                      {embedMarkdown}
                    </pre>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use <code className="rounded bg-secondary px-1 py-0.5">?view=image&amp;embed=1</code>, <code className="rounded bg-secondary px-1 py-0.5">?view=video&amp;embed=1</code>, or <code className="rounded bg-secondary px-1 py-0.5">?view=audio&amp;embed=1</code> to embed generation tools. Example image URL: {studioEmbedUrl}
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFullscreen((prev) => !prev)}
              className="h-9 w-9 flex-none"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen chat"}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen chat"}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHeaderCollapsed((prev) => !prev)}
              className="h-9 w-9 flex-none"
              title={headerCollapsed ? "Expand header controls" : "Collapse header controls"}
              aria-label={headerCollapsed ? "Expand header controls" : "Collapse header controls"}
            >
              {headerCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
            </div>
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
                <div className="max-w-7xl mx-auto w-full pt-2">
                  <p className="text-xs text-destructive">{modelsError}</p>
                </div>
              ) : null}
              <div className="max-w-7xl mx-auto w-full pt-2">
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
              <div className="max-w-7xl mx-auto w-full pt-2">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-4" ref={scrollRef}>
        <div className="mx-auto w-full max-w-7xl space-y-4 py-4 sm:space-y-6 sm:py-6">
          <AnimatePresence initial={false} mode="popLayout">
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex min-h-[240px] flex-col items-center justify-center space-y-4 text-center sm:min-h-[400px]"
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-primary/60" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-medium sm:text-xl">How can I help you create?</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Ask me to generate images, videos, audio, refine prompts, or brainstorm ideas.
                  </p>
                </div>
                <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="col-span-2 h-11 justify-start sm:col-span-1"
                    onClick={() => setTurnIntent("generate_image")}
                    disabled={!toolAvailability.image}
                  >
                    <ImageIcon className="mr-2 h-4 w-4" />
                    Create image
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 justify-start"
                    onClick={() => setTurnIntent("generate_video")}
                    disabled={!toolAvailability.video}
                  >
                    <Video className="mr-2 h-4 w-4" />
                    Create video
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 justify-start"
                    onClick={() => setTurnIntent("chat")}
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    Ask only
                  </Button>
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
                const attachmentItems = message.attachments ?? [];

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
                      "flex gap-2 sm:gap-4 group",
                      isUser ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <Avatar className={cn("h-7 w-7 sm:h-8 sm:w-8 border", isUser ? "bg-primary text-primary-foreground" : "bg-card")}>
                      <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
                        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn(
                      "flex flex-col gap-2 max-w-[96%] sm:max-w-[88%]",
                      isUser ? "items-end" : "items-start",
                      "w-full"
                    )}>
                      {/* Name/Role */}
                      <div className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        <span>{isUser ? "You" : isTool ? "System Helper" : "Agent"}</span>
                        {isUser && message.turnIntent ? (
                          <span className="rounded-full border border-border/60 bg-background/70 px-1.5 py-0.5 normal-case tracking-normal text-muted-foreground">
                            {chatTurnIntentLabel(message.turnIntent)}
                          </span>
                        ) : null}
                      </div>

                      {/* Content */}
                      <div className={cn(
                        "relative rounded-2xl px-3.5 py-2.5 sm:px-5 sm:py-3.5 text-sm shadow-sm w-full transition-all duration-300",
                        isUser
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : isTool
                            ? "bg-secondary/50 text-secondary-foreground border border-border/50 text-xs font-mono"
                            : "glass-card text-foreground rounded-tl-sm"
                      )}>

                        {thoughtContent && <ThinkingBlock content={thoughtContent} />}

                        {attachmentItems.length ? (
                          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {attachmentItems.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="flex min-w-0 items-center gap-2 rounded-lg border border-border/50 bg-background/45 p-2"
                              >
                                {attachment.kind === "image" && attachment.dataUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => openAttachmentPreview(attachment, displayContent)}
                                    className="group/attachment-image relative h-12 w-12 flex-none overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    title="Open fullscreen preview"
                                    aria-label={`Open ${attachment.name} fullscreen preview`}
                                  >
                                    <img
                                      src={attachment.dataUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/attachment-image:opacity-100">
                                      <Maximize2 className="h-4 w-4 text-white" />
                                    </span>
                                  </button>
                                ) : (
                                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary/70 text-muted-foreground">
                                    <FileText className="h-5 w-5" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 text-left">
                                  <div className="truncate text-xs font-semibold">
                                    {attachment.name}
                                  </div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {attachment.kind}
                                    {attachment.pagesRead && attachment.totalPages
                                      ? ` · ${attachment.pagesRead}/${attachment.totalPages} pages`
                                      : ""}
                                    {attachment.truncated ? " · truncated" : ""}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {displayContent ? (
                          isUser ? (
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{displayContent}</p>
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

                        {isAssistant && message.toolCalls?.length ? (
                          <ToolCallsBlock toolCalls={message.toolCalls} />
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3 w-full">
                            {mediaItems.map((item) => (
                              <motion.div
                                key={item.id}
                                layoutId={item.id}
                                className="relative rounded-lg overflow-hidden border bg-background/50 group/image p-1.5"
                              >
                                {item.kind === "image" ? (
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => openMediaPreview(item, message.promptUsed ?? displayContent)}
                                      className="block w-full overflow-hidden rounded-md bg-checkered focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label="Open generated image preview"
                                    >
                                      <img
                                        src={item.dataUrl}
                                        alt={message.promptUsed ?? displayContent ?? "Generated image"}
                                        className="h-auto max-h-96 w-full object-contain"
                                      />
                                    </button>
                                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5">
                                      <div className="min-w-0 flex-1">
                                        {item.model ? (
                                          <span className="inline-block max-w-full truncate rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-secondary-foreground">
                                            {item.model}
                                          </span>
                                        ) : null}
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 px-2.5 text-xs"
                                        onClick={() => openMediaPreview(item, message.promptUsed ?? displayContent)}
                                      >
                                        <Maximize2 className="mr-1.5 h-4 w-4" />
                                        Preview
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-10 px-2.5 text-xs"
                                        onClick={() => downloadChatMedia(item)}
                                      >
                                        <Download className="mr-1.5 h-4 w-4" />
                                        Download
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
      <footer className="glass mt-auto flex-none border-t p-2.5 sm:p-4">
        <div className="max-w-7xl mx-auto w-full relative">
          <AnimatePresence>
            {messages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute -top-9 right-0 sm:-top-12"
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

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={attachmentAccept}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) {
                void addAttachmentFiles(event.target.files);
              }
              event.currentTarget.value = "";
            }}
          />

          {pendingAttachments.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex max-w-full items-center gap-2 rounded-lg border border-border/60 bg-background/75 px-2 py-1.5 text-xs"
                >
                  {attachment.kind === "image" && attachment.dataUrl ? (
                    <img
                      src={attachment.dataUrl}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="max-w-[14rem] truncate">
                    {attachment.name}
                    {attachment.truncated ? " (truncated)" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(attachment.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/70 p-2 shadow-sm backdrop-blur sm:p-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <div className="mt-0.5 rounded-lg bg-primary/10 p-1.5 text-primary">
                {currentTurnDecision.intent === "generate_image" ? (
                  <ImageIcon className="h-4 w-4" />
                ) : currentTurnDecision.intent === "generate_video" ? (
                  <Video className="h-4 w-4" />
                ) : currentTurnDecision.intent === "generate_audio" ? (
                  <AudioLines className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  <span className="sm:hidden">
                    Next · {chatTurnIntentCompactLabel(currentTurnDecision.intent)}
                  </span>
                  <span className="hidden sm:inline">
                    Next action · {chatTurnIntentLabel(currentTurnDecision.intent)}
                  </span>
                </p>
                <p aria-live="polite" className="mt-0.5 hidden text-[11px] leading-relaxed text-muted-foreground sm:block">
                  {currentTurnDecision.reason}
                </p>
              </div>
            </div>
            <Select
              value={turnIntent}
              onValueChange={(value) => {
                if (isChatTurnIntent(value)) setTurnIntent(value);
              }}
            >
              <SelectTrigger
                aria-label="Choose action for this chat turn"
                className="h-10 w-[168px] shrink-0 bg-background sm:h-11 sm:w-[190px]"
              >
                <span>
                  <span className="sm:hidden">
                    {chatTurnIntentCompactLabel(turnIntent)}
                  </span>
                  <span className="hidden sm:inline">
                    {chatTurnIntentLabel(turnIntent)}
                  </span>
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto · Agent decides</SelectItem>
                <SelectItem value="chat">Chat only</SelectItem>
                <SelectItem value="generate_image" disabled={!toolAvailability.image}>
                  Create image
                </SelectItem>
                <SelectItem value="generate_video" disabled={!toolAvailability.video}>
                  Create video
                </SelectItem>
                <SelectItem value="generate_audio" disabled={!toolAvailability.audio}>
                  Create audio
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="glass-card relative flex items-end gap-2 rounded-2xl p-1.5 shadow-lg ring-1 ring-white/20 sm:rounded-3xl">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachmentUploadDisabled || attachmentLoading || pendingAttachments.length >= MAX_PENDING_ATTACHMENTS}
              title={
                attachmentUploadDisabled
                  ? "Selected model does not advertise image or file input"
                  : "Attach image, PDF, or text file"
              }
              aria-label="Attach file"
              className="mb-0.5 h-11 w-11 rounded-full"
            >
              {attachmentLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Paperclip className="h-5 w-5" />
              )}
            </Button>
            <div className="flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  busy
                    ? `Queue another ${providerLabel} request...`
                    : pendingAttachments.length
                      ? "Ask about the attached files..."
                      : `Message ${providerLabel} Agent...`
                }
                className="max-h-[140px] min-h-[46px] w-full resize-none border-0 bg-transparent px-3 py-3 text-base focus-visible:ring-0 sm:max-h-[200px] sm:px-4"
                rows={1}
              />
            </div>
            {busy ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={stopChat}
                title="Stop current request"
                aria-label="Stop current request"
                className="mb-0.5 h-11 w-11 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : null}
            <Button
              size="icon"
              onClick={() => void submitMessage()}
              disabled={
                (!input.trim() && !pendingAttachments.length) ||
                !hasApiAccess
              }
              title={busy ? "Queue request" : "Send request"}
              aria-label={busy ? "Queue request" : "Send request"}
              className={cn(
                "mb-0.5 h-11 w-11 rounded-full shadow transition-colors",
                input.trim() ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground"
              )}
            >
              {busy && !input.trim() ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
          <div className="mt-2 hidden flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
              Input: {summarizeModalities(selectedChatModel?.inputModalities)}
            </span>
            <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
              Output: {summarizeModalities(selectedChatModel?.outputModalities)}
            </span>
            {attachmentUploadDisabled ? (
              <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                Uploads unavailable for this model metadata
              </span>
            ) : null}
            {chatModelToolCapability === false ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                Model does not advertise tool calling; explicit generation uses local fallback
              </span>
            ) : null}
          </div>
          {(busy || queuedTurns.length > 0) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-1">
                <Loader2 className={cn("h-3 w-3", busy && "animate-spin")} />
                {busy ? "Running" : "Idle"}
              </span>
              <span className="inline-flex rounded-full border border-border/60 bg-background/60 px-2 py-1">
                {queuedTurns.length} queued
              </span>
              {queuedTurns.slice(0, 2).map((turn, index) => (
                <span
                  key={turn.id}
                  className="max-w-[22rem] truncate rounded-full border border-border/60 bg-background/60 px-2 py-1"
                  title={turn.content}
                >
                  #{index + 1} · {chatTurnIntentLabel(turn.turnIntent)} · {turn.content}
                </span>
              ))}
            </div>
          ) : null}
          {chatError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">{chatError}</p>
          ) : null}
          {attachmentError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">{attachmentError}</p>
          ) : null}
        </div>
      </footer>
    </div>
    <ImageViewer
      open={!!activeMediaPreview}
      onOpenChange={closeMediaPreview}
      imageUrl={activeMediaPreview?.imageUrl ?? null}
      prompt={activeMediaPreview?.prompt ?? ""}
      model={activeMediaPreview?.model ?? ""}
      provider={activeMediaPreview?.provider ?? ""}
      kind={activeMediaPreview?.kind}
      mimeType={activeMediaPreview?.mimeType ?? null}
    />
    </>
  );
}
