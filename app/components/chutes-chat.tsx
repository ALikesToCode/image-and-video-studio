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
} from "lucide-react";
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
  NAVY_CHAT_MODELS as STATIC_NAVY_CHAT_MODELS,
  NAVY_IMAGE_MODELS as STATIC_NAVY_IMAGE_MODELS,
  NAVY_TTS_MODELS as STATIC_NAVY_TTS_MODELS,
  NAVY_VIDEO_MODELS as STATIC_NAVY_VIDEO_MODELS,
  type ModelOption,
  type ChatProvider,
} from "@/lib/constants";
import type { NavyUsageResponse } from "@/lib/types";
import { dataUrlFromBase64, fetchAsDataUrl, cn } from "@/lib/utils";
import {
  ensureSelectedModelOption,
  filterModelOptions,
  hasModelMetadata,
  isFetchedOnlyModel,
} from "@/lib/model-options";
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
import {
  type ChatAttachmentAsset,
  type ChatImageAsset,
  type ChatMediaAsset,
  buildAssistantToolContextContent,
  createSyntheticFallbackToolCall,
  detectForcedToolCall,
  isDeepSeekV4Model,
  normalizeImageToolModelRequest,
  repairImageToolArguments,
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
  buildProviderPolicyHintForImageModels,
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
  images?: ChatImageAsset[];
  media?: ChatMediaAsset[];
  attachments?: ChatAttachmentAsset[];
  transient?: boolean;
};

type QueuedChatTurn = {
  id: string;
  content: string;
  attachments: ChatAttachmentAsset[];
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
  }) => Promise<void> | void;
};

const NAVY_IMAGE_GUIDE_PROMPT = `# Prompt Guide for NavyAI Image Generation

Use concise, vivid descriptions with clear subjects, styles, and lighting. Ask for missing details.
Summarize the final prompt before generating, and prefer sizes like 1024x1024 unless specified.
When the user provides reference images, pass them through image_url as one URL/data URI or an array of up to 5 references.`;

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
const getReasoningPreferencesStorageKey = (provider: ChatProvider) =>
  `studio_chat_${provider}_reasoning_preferences`;
const MAX_CHAT_MESSAGES = 120;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 80;
const MAX_PENDING_ATTACHMENTS = 6;
const CHAT_TEXT_ATTACHMENT_MAX_CHARS = 18_000;
const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

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

const STATIC_MODEL_IDS = {
  chutes: {
    chat: idsFor(STATIC_CHUTES_LLM_MODELS),
    image: idsFor(STATIC_CHUTES_IMAGE_MODELS),
    video: idsFor(STATIC_CHUTES_VIDEO_MODELS),
    audio: idsFor(STATIC_CHUTES_TTS_MODELS),
  },
  navy: {
    chat: idsFor(STATIC_NAVY_CHAT_MODELS),
    image: idsFor(STATIC_NAVY_IMAGE_MODELS),
    video: idsFor(STATIC_NAVY_VIDEO_MODELS),
    audio: idsFor(STATIC_NAVY_TTS_MODELS),
  },
} satisfies Record<ChatProvider, Record<"chat" | "image" | "video" | "audio", Set<string>>>;

const modelSupportsReasoning = (
  provider: ChatProvider,
  modelId: string,
  modelOption?: ModelOption,
) => provider === "navy" && (modelOption?.supportsReasoning === true || isDeepSeekV4Model(modelId));

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
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [systemPromptHydrated, setSystemPromptHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const queuedTurnsRef = useRef<QueuedChatTurn[]>([]);
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachmentAsset[]>([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
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
  const providerLabel = provider === "navy" ? "NavyAI" : "Chutes";
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
  const enqueueChatTurn = useCallback((content: string, attachments: ChatAttachmentAsset[]) => {
    updateQueuedTurns((prev) => [
      ...prev,
      {
        id: createId(),
        content,
        attachments,
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
  const isDeepSeekV4ChatModel = provider === "navy" && isDeepSeekV4Model(model);
  const chatModelSupportsReasoning = modelSupportsReasoning(provider, model, selectedChatModel);
  const availableImageModelIds = useMemo(
    () => new Set(imageModels.map((item) => item.id)),
    [imageModels]
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
                  "Generate an image. Prefer the active ordered pipeline; include a model only when one clearly fits so it can be tried first before ordered fallback.",
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
                      description:
                        "OpenAI GPT Image quality: low, medium, high, or auto.",
                    },
                    style: {
                      type: "string",
                      description:
                        "Optional provider style when the selected image model supports it.",
                    },
                    image_url: {
                      oneOf: [
                        { type: "string" },
                        {
                          type: "array",
                          items: { type: "string" },
                          maxItems: 5,
                        },
                      ],
                      description:
                        "Optional reference image URL or data URI, or up to 5 reference images for multi-reference editing.",
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
                  "Generate an image. Prefer the active ordered pipeline; include a model only when one clearly fits so it can be tried first before ordered fallback.",
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
    const activeImageModelSummary = activeToolImageModels.join(", ");
    const fluxModelActive = activeToolImageModels.some((item) => /flux/i.test(item));
    const providerPolicyHint = buildProviderPolicyHintForImageModels(
      activeToolImageModels
    );
    const promptGuide =
      provider === "navy" ? NAVY_IMAGE_GUIDE_PROMPT : CHUTES_IMAGE_GUIDE_PROMPT;
    const enabledToolLines: string[] = [];
    if (toolSettings.image) {
      enabledToolLines.push(
        `- generate_image (default model: ${toolImageModel}; preferred active image order: ${activeImageModelSummary || toolImageModel}; available image models: ${modelList})`
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
      ? `Flux mode is active (active image models: ${activeImageModelSummary || toolImageModel}). Strictly follow the Flux Cross-Modal Prompt Protocol below whenever a Flux-family image model is active. The tool layer will also convert Flux-family image requests into an "Artwork direction" prompt with "Desired qualities"; do not send raw negative-prompt style text for Flux.`
      : "If the user asks for Flux or selects a Flux model, switch into Flux Cross-Modal Prompt Protocol.";
    const policyScopeHint = providerPolicyHint
      ? `${providerPolicyHint}
Only apply those provider-policy guardrails when the target image model is in that family. Leave unrelated image models unchanged.`
      : "";
    const imagePromptInstruction =
      "Before calling generate_image, send the tool an optimized final visual prompt, not the user's raw request text. Always include a prompt string. Prefer the active image model order from left to right. Include a model only when one available model clearly fits the request; that model will be tried first before ordered fallback. Do not include the default model just to restate the default; omit model when uncertain so the preferred order starts from the top. Try the ordered pipeline rather than giving up after one model. For OpenAI GPT Image models, write prompts in a production guide shape: background/scene, subject, key details, composition, lighting/mood, and constraints; include the intended output format; describe materials, textures, framing, viewpoint, placement, pose, gaze, and object interactions; render exact in-image text only when explicitly requested; and preserve explicit edit/reference invariants. For Flux-family models, convert the request into Flux-ready artwork direction with positive visual details. For stricter OpenAI/Gemini-family image models, phrase adult subjects as clearly adult, tasteful, non-explicit, consensual editorial artwork so the first provider request is policy-compliant instead of relying on retries.";

    const defaultPrompt = `${promptGuide}
${FLUX_CROSS_MODAL_GUIDE}

You are a generation assistant. Help craft prompts, ask for missing details when needed, and summarize the final prompt before calling a generation tool.
${crossModalHint}
${fluxHint}
${policyScopeHint}
${imagePromptInstruction}
If the user explicitly asks to generate now, you must call the relevant tool in the same turn (do not stop at prompt drafting only).
${providerHint}
${toolInstruction}`;
    const customPrompt = customSystemPrompt.trim();
    if (!customPrompt) return defaultPrompt;
    return `${customPrompt}

${defaultPrompt}`;
  }, [
    activeToolImageModels,
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

  const callChatStreaming = async (
    items: ChatMessage[],
    onUpdate: (update: { content?: string; thinking?: string; toolCalls?: ToolCall[] }) => void,
    toolChoiceOverride?: unknown
  ) => {
    const endpoint = provider === "navy" ? "/api/navy/chat" : "/api/chutes/chat";
    const hasEnabledTools = toolSpec.length > 0;
    const reasoningPayload =
      provider === "navy" && chatModelSupportsReasoning
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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...toChatCompletionMessages(
            items.filter((item) => !item.transient),
            {
              includeReasoningContent: provider === "navy",
            }
          ),
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
        ...reasoningPayload,
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
        } catch {
          // Ignore malformed stream fragments and keep reading.
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
  }: {
    targetModel: string;
    currentPrompt: string;
    errorMessage: string;
    nextAttempt: number;
    maxAttempts: number;
  }) => {
    const fallbackPrompt = buildSaferImagePromptForModel(targetModel, currentPrompt);
    const recoveryInstruction = buildImagePolicyRecoveryPrompt({
      model: targetModel,
      prompt: currentPrompt,
      errorMessage,
      nextAttempt,
      maxAttempts,
    });

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
            temperature: 0.2,
            ...(provider === "navy" && isDeepSeekV4Model(recoveryModel)
              ? {
                  thinking: { type: "disabled" },
                }
              : {}),
          }),
        });
        if (!response.ok) continue;
        const recoveredPrompt = normalizeRecoveredImagePrompt(
          await readAssistantTextResponse(response)
        );
        if (recoveredPrompt) return recoveredPrompt;
      } catch {
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
    }) => void
  ) => {
    if (!apiKey.trim()) {
      throw new Error("Missing API key for image tool.");
    }
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
    const endpoint = provider === "navy" ? "/api/navy/image" : "/api/chutes/image";
    const baseBody: Record<string, unknown> = {};
    if (provider === "navy") {
      const numberOfImages = getNumberArg(finalArgs, ["n"]);
      const size = getStringArg(finalArgs, ["size"]);
      const quality = getStringArg(finalArgs, ["quality"]);
      const style = getStringArg(finalArgs, ["style"]);
      const imageUrl = getStringOrStringArrayArg(finalArgs, ["image_url", "image"]);
      if (size) Object.assign(baseBody, resolveNavyChatImageSizing(size));
      if (quality) baseBody.quality = quality;
      if (style) baseBody.style = style;
      if (imageUrl) baseBody.imageUrl = imageUrl;
      if (numberOfImages && numberOfImages > 0) {
        baseBody.numberOfImages = Math.max(1, Math.round(numberOfImages));
      }
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
    }
    const imageRequests = prepareImageModelRequests({
      models: modelsToRun,
      baseBody,
      prompt,
      negativePrompt: negativePrompt || undefined,
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
      const executeRequest = async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-api-key": apiKey,
          },
          body: JSON.stringify(request.body),
        });
        let payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Image tool failed.");
        }

        if (provider === "navy" && typeof payload?.id === "string" && payload.id) {
          let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
          let didComplete = false;
          for (let attempt = 0; attempt < NAVY_JOB_POLL_MAX_ATTEMPTS && !didComplete; attempt += 1) {
            const pollResponse = await fetch(
              `/api/navy/image?id=${encodeURIComponent(payload.id)}`,
              {
                headers: {
                  "x-user-api-key": apiKey,
                },
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
            await new Promise((resolve) => setTimeout(resolve, delayMs));
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
            images.map(async (image) => {
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
                };
              }
              if (typeof image?.url === "string") {
                const dataUrl = await fetchAsDataUrl(image.url);
                return {
                  id: createId(),
                  dataUrl,
                  mimeType,
                  model: targetModel,
                };
              }
              return null;
            })
          )
        ).filter(
          (
            item
          ): item is { id: string; dataUrl: string; mimeType: string; model: string } =>
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
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": apiKey,
        },
        body: JSON.stringify({
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
      for (let attempt = 0; attempt < NAVY_JOB_POLL_MAX_ATTEMPTS; attempt += 1) {
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
          await new Promise((resolve) =>
            setTimeout(resolve, NAVY_JOB_POLL_INTERVAL_MS)
          );
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
          "x-user-api-key": apiKey,
        },
        body: JSON.stringify({ url: videoUrl }),
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

    const sourceImage = getStringArg(args, ["image", "image_url"]);
    if (!sourceImage) {
      throw new Error("Chutes video generation requires an image URL or data URI.");
    }
    const fps = getNumberArg(args, ["fps"]);
    const guidanceScale = getNumberArg(args, ["guidance_scale_2"]);
    const response = await fetch("/api/chutes/video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": apiKey,
      },
      body: JSON.stringify({
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

  const handleToolCalls = async (
    toolCalls: ToolCall[],
    onProgress?: (message: ChatMessage) => void,
    context?: { assistantContent: string; userPrompt: string }
  ) => {
    const toolMessages: ChatMessage[] = [];
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name ?? "";
      let args: Record<string, unknown> = {};

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
          });
          if (saveToGallery && onSaveImages) {
            await onSaveImages({
              images: result.images,
              prompt: result.prompt,
              model: result.model,
            });
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
          const result = await runGenerateVideo(args);
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

  const runChatTurn = async (
    trimmed: string,
    attachments: ChatAttachmentAsset[] = []
  ) => {
    if (!apiKey.trim()) {
      setChatError(`Add your ${providerLabel} API key in settings.`);
      const nextQueuedTurn = takeNextQueuedTurn();
      if (nextQueuedTurn) {
        void runChatTurn(nextQueuedTurn.content, nextQueuedTurn.attachments);
      } else {
        setChatBusy(false);
      }
      return;
    }
    if (!model) {
      setChatError("Select a chat model.");
      const nextQueuedTurn = takeNextQueuedTurn();
      if (nextQueuedTurn) {
        void runChatTurn(nextQueuedTurn.content, nextQueuedTurn.attachments);
      } else {
        setChatBusy(false);
      }
      return;
    }
    setChatError(null);
    setChatBusy(true);

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed || "Please analyze the attached file(s).",
      attachments,
    };

    // Optimistic update
    let currentMessages: ChatMessage[] = [...messagesRef.current, userMessage];
    commitMessages(currentMessages);
    const forcedToolCall = detectForcedToolCall(trimmed, toolSettings);

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
          step === 0 && forcedToolCall
            ? { type: "function", function: { name: forcedToolCall } }
            : undefined
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
          if (step === 0 && forcedToolCall) {
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
                { assistantContent: assistantToolContext, userPrompt: trimmed }
              );
              if (toolMessages.length) {
                removeProgressMessages([syntheticToolCall]);
                currentMessages = [...currentMessages, ...toolMessages];
                commitMessages(currentMessages);
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
          { assistantContent: assistantToolContext, userPrompt: trimmed }
        );
        removeProgressMessages(finalToolCalls);
        currentMessages = [...currentMessages, ...toolMessages];
        commitMessages(currentMessages);
      }
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Unable to run chat."
      );
    } finally {
      const nextQueuedTurn = takeNextQueuedTurn();
      if (nextQueuedTurn) {
        void runChatTurn(nextQueuedTurn.content, nextQueuedTurn.attachments);
      } else {
        setChatBusy(false);
      }
    }
  };

  const submitMessage = () => {
    const trimmed = input.trim();
    const attachmentsToSend = pendingAttachments;
    if (!trimmed && !attachmentsToSend.length) return;
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
    setPendingAttachments([]);
    setAttachmentError(null);

    if (busyRef.current || queuedTurnsRef.current.length) {
      enqueueChatTurn(trimmed, attachmentsToSend);
      return;
    }

    void runChatTurn(trimmed, attachmentsToSend);
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
                {provider === "navy" ? "NavyAI Chat" : "Chutes Agent"}
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
                {provider === "navy" ? "NavyAI Chat" : "Chutes Agent"}
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
                <SelectItem value="chutes">Chutes</SelectItem>
                <SelectItem value="navy">NavyAI</SelectItem>
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
                  </div>
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
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium px-1">
                        {isUser ? "You" : isTool ? "System Helper" : "Agent"}
                      </span>

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
                                  <img
                                    src={attachment.dataUrl}
                                    alt=""
                                    className="h-12 w-12 rounded-md object-cover"
                                  />
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
                                  <div className="relative aspect-square rounded-md overflow-hidden">
                                    <img
                                      src={item.dataUrl}
                                      alt="Generated"
                                      className="w-full h-full object-cover transition-transform duration-500 group-hover/image:scale-110"
                                    />
                                    {item.model ? (
                                      <div className="absolute left-2 top-2 flex flex-wrap gap-2">
                                        <span className="rounded-full bg-background/85 px-2 py-1 text-[10px] font-semibold text-foreground shadow-sm backdrop-blur">
                                          {item.model}
                                        </span>
                                      </div>
                                    ) : null}
                                    <div className="absolute inset-0 bg-black/50 opacity-100 sm:opacity-0 sm:group-hover/image:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
              className="mb-1 h-10 w-10 rounded-full"
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
            <Button
              size="icon"
              onClick={() => void submitMessage()}
              disabled={(!input.trim() && !pendingAttachments.length) || !apiKey.trim()}
              title={busy ? "Queue request" : "Send request"}
              aria-label={busy ? "Queue request" : "Send request"}
              className={cn(
                "h-10 w-10 rounded-full mb-1 transition-all duration-300 shadow",
                input.trim() ? "bg-primary text-primary-foreground hover:scale-105" : "bg-muted text-muted-foreground"
              )}
            >
              {busy && !input.trim() ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
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
                  #{index + 1} {turn.content}
                </span>
              ))}
            </div>
          ) : null}
          {chatError ? (
            <p className="mt-2 text-xs text-destructive">{chatError}</p>
          ) : null}
          {attachmentError ? (
            <p className="mt-2 text-xs text-destructive">{attachmentError}</p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
