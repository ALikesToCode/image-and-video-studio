import type { ChatProvider } from "./constants.ts";
import {
  retryAsyncOperation,
  resolveActiveImageToolModels,
} from "./studio-generation.ts";

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

export type ChatAttachmentAsset = {
  id: string;
  kind: "image" | "pdf" | "text";
  name: string;
  mimeType: string;
  size?: number;
  dataUrl?: string;
  text?: string;
  pagesRead?: number;
  totalPages?: number;
  truncated?: boolean;
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

type ChatCompletionPayloadInput = {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  omitToolChoiceForUnsupportedModels?: boolean;
  thinking?: { type?: unknown };
  reasoningEffort?: unknown;
};

type ChatCompletionMessageInput = {
  role: "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  name?: string;
  attachments?: ChatAttachmentAsset[];
};

type ChatCompletionMessagesOptions = {
  includeReasoningContent?: boolean;
};

const normalizeValue = (value: string) => value.trim().replace(/\r\n/g, "\n");
const stripOuterQuotes = (value: string) =>
  normalizeValue(value).replace(/^["']|["']$/g, "");
const normalizeComparable = (value: string) =>
  stripOuterQuotes(value).replace(/\s+/g, " ").toLowerCase();

const NEGATIVE_PROMPT_PATTERN =
  /\b(blurry|blur|bad anatomy|bad hands|extra limbs?|extra fingers?|deformed|malformed|mutated|disfigured|watermark|logo|text|caption|signature|low detail|low quality|flat shading|artifact|noise|grainy|duplicate|poorly drawn)\b/i;

const PROMPT_STOP_LABEL_PATTERN =
  /^\s*(?:optional\s+)?(?:negative prompt|video readiness note|audio mood note|image model|model)\s*:/im;

export const shouldOmitToolChoiceForModel = (model: string) => {
  const normalized = model.trim().toLowerCase();
  return (
    normalized === "deepseek-reasoner" ||
    normalized.startsWith("deepseek-") ||
    normalized.includes("/deepseek-") ||
    normalized.includes("deepseek-ai/")
  );
};

export const isDeepSeekV4Model = (model: string) => {
  const normalized = model.trim().toLowerCase();
  return normalized === "deepseek-v4-pro" || normalized === "deepseek-v4-flash";
};

export const normalizeDeepSeekThinkingType = (value: unknown) =>
  value === "disabled" ? "disabled" : "enabled";

export const normalizeReasoningEffort = (value: unknown) => {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  if (value === "max") return "xhigh";
  return "high";
};

export const normalizeDeepSeekReasoningEffort = (value: unknown) => {
  if (value === "max" || value === "xhigh") return "max";
  return "high";
};

export const buildChatCompletionPayload = ({
  model,
  messages,
  tools,
  toolChoice,
  maxTokens,
  temperature,
  stream = true,
  omitToolChoiceForUnsupportedModels = false,
  thinking,
  reasoningEffort,
}: ChatCompletionPayloadInput) => {
  const isDeepSeekV4 = isDeepSeekV4Model(model);
  const hasReasoningEffort = reasoningEffort !== undefined;
  const thinkingType = isDeepSeekV4
    ? normalizeDeepSeekThinkingType(thinking?.type)
    : null;
  const payload: Record<string, unknown> = {
    model,
    messages,
    stream,
  };

  if (thinkingType) {
    payload.thinking = { type: thinkingType };
    if (thinkingType === "enabled") {
      payload.reasoning_effort = normalizeDeepSeekReasoningEffort(reasoningEffort);
    }
  } else if (hasReasoningEffort) {
    payload.reasoning_effort = normalizeReasoningEffort(reasoningEffort);
  }

  const hasTools = Array.isArray(tools) && tools.length > 0;
  if (hasTools) {
    payload.tools = tools;
  }
  if (
    toolChoice !== undefined &&
    hasTools &&
    !(
      omitToolChoiceForUnsupportedModels &&
      shouldOmitToolChoiceForModel(model)
    )
  ) {
    payload.tool_choice = toolChoice;
  }
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
    payload.max_tokens = maxTokens;
  }
  if (
    typeof temperature === "number" &&
    Number.isFinite(temperature) &&
    !(isDeepSeekV4 && thinkingType === "enabled")
  ) {
    payload.temperature = temperature;
  }

  return payload;
};

const clonePayload = (payload: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

const withoutPayloadFields = (
  payload: Record<string, unknown>,
  fields: string[]
) => {
  const next = clonePayload(payload);
  let changed = false;
  for (const field of fields) {
    if (field in next) {
      delete next[field];
      changed = true;
    }
  }
  return changed ? next : null;
};

export const stripReasoningContentFromChatPayload = (
  payload: Record<string, unknown>
) => {
  const messages = Array.isArray(payload.messages) ? payload.messages : null;
  if (!messages) return null;

  let changed = false;
  const next = clonePayload(payload);
  next.messages = messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return message;
    }
    const record = { ...(message as Record<string, unknown>) };
    if ("reasoning_content" in record) {
      delete record.reasoning_content;
      changed = true;
    }
    if ("reasoning" in record) {
      delete record.reasoning;
      changed = true;
    }
    return record;
  });

  return changed ? next : null;
};

export const buildAssistantToolContextContent = ({
  content,
  thinking,
}: {
  content?: string | null;
  thinking?: string | null;
}) =>
  [content, thinking]
    .map((value) => (typeof value === "string" ? normalizeValue(value) : ""))
    .filter(Boolean)
    .join("\n\n");

export const buildChatCompletionRecoveryPayloads = (
  payload: Record<string, unknown>
) => {
  const candidates: Array<{ label: string; payload: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  const addCandidate = (label: string, candidate: Record<string, unknown> | null) => {
    if (!candidate) return;
    const key = JSON.stringify(candidate);
    if (seen.has(key) || key === JSON.stringify(payload)) return;
    seen.add(key);
    candidates.push({ label, payload: candidate });
  };

  const withoutReasoning = stripReasoningContentFromChatPayload(payload);
  addCandidate("strip-reasoning", withoutReasoning);

  const reasoningBase = withoutReasoning ?? payload;
  addCandidate(
    "omit-reasoning-controls",
    withoutPayloadFields(reasoningBase, ["reasoning_effort", "thinking"])
  );
  addCandidate("omit-sampling", withoutPayloadFields(reasoningBase, ["temperature"]));

  const toolChoiceBase = withoutReasoning ?? payload;
  addCandidate("omit-tool-choice", withoutPayloadFields(toolChoiceBase, ["tool_choice"]));

  const textOnlyBase = withoutReasoning ?? payload;
  addCandidate(
    "text-only",
    withoutPayloadFields(textOnlyBase, ["tools", "tool_choice"])
  );

  return candidates;
};

export const toChatCompletionMessages = (
  messages: ChatCompletionMessageInput[],
  { includeReasoningContent = false }: ChatCompletionMessagesOptions = {}
) => {
  const pendingToolCallIds = new Set<string>();
  return messages.flatMap((message) => {
    if (
      message.role === "tool" &&
      /^Invoking\s+[a-z0-9_]+\.\.\.$/i.test(message.content.trim())
    ) {
      return [];
    }

    if (message.role === "tool") {
      const toolCallId =
        typeof message.toolCallId === "string" ? message.toolCallId : "";
      if (!toolCallId || !pendingToolCallIds.has(toolCallId)) {
        return [];
      }
      pendingToolCallIds.delete(toolCallId);
    }

    const hasToolCalls =
      message.role === "assistant" &&
      Array.isArray(message.toolCalls) &&
      message.toolCalls.length > 0;
    const base: Record<string, unknown> = {
      role: message.role,
      content:
        message.role === "user"
          ? buildUserMessageContent(message.content, message.attachments)
          : message.content,
    };

    if (
      includeReasoningContent &&
      message.role === "assistant" &&
      typeof message.thinking === "string" &&
      message.thinking.trim()
    ) {
      base.reasoning_content = message.thinking;
    }

    if (hasToolCalls) {
      base.tool_calls = message.toolCalls;
      for (const toolCall of message.toolCalls ?? []) {
        if (!toolCall || typeof toolCall !== "object") continue;
        const id = (toolCall as Record<string, unknown>).id;
        if (typeof id === "string" && id) {
          pendingToolCallIds.add(id);
        }
      }
    }

    if (message.role === "tool") {
      if (message.toolCallId) base.tool_call_id = message.toolCallId;
      if (message.name) base.name = message.name;
    }

    return [base];
  });
};

const attachmentTextHeader = (attachment: ChatAttachmentAsset) => {
  const detailParts = [
    attachment.kind.toUpperCase(),
    attachment.mimeType,
    typeof attachment.size === "number" ? `${attachment.size} bytes` : "",
    typeof attachment.pagesRead === "number" && typeof attachment.totalPages === "number"
      ? `${attachment.pagesRead}/${attachment.totalPages} pages`
      : "",
    attachment.truncated ? "truncated" : "",
  ].filter(Boolean);
  return `Attached ${attachment.kind} "${attachment.name}"${
    detailParts.length ? ` (${detailParts.join(", ")})` : ""
  }`;
};

export const buildUserMessageContent = (
  content: string,
  attachments?: ChatAttachmentAsset[]
) => {
  const normalizedContent = normalizeValue(content);
  const normalizedAttachments = sanitizeChatAttachmentAssets(attachments);
  if (!normalizedAttachments.length) return content;

  const parts: Array<Record<string, unknown>> = [];
  if (normalizedContent) {
    parts.push({ type: "text", text: normalizedContent });
  }

  for (const attachment of normalizedAttachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      parts.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl },
      });
      continue;
    }

    if (attachment.text?.trim()) {
      parts.push({
        type: "text",
        text: `${attachmentTextHeader(attachment)}\n\n${attachment.text.trim()}`,
      });
    }
  }

  return parts.length ? parts : content;
};

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

const extractNegativePromptFromAssistant = (assistantContent: string) =>
  extractTaggedBlock(assistantContent, [
    "optional negative prompt",
    "negative prompt",
  ]);

const stripAssistantPreamble = (value: string) =>
  value
    .replace(
      /^\s*(?:let me|i(?:'|’)?ll|i will|here(?:'|’)?s|here is)[^\n]*(?:\n+|$)/i,
      ""
    )
    .trim();

export const extractImagePromptForToolCall = (
  assistantContent: string,
  userPrompt: string
) => {
  const tagged = extractTaggedBlock(assistantContent, [
    "final flux prompt",
    "final image prompt",
    "image prompt",
    "final prompt",
  ]);
  if (tagged) return tagged;

  const beforeMetadata = assistantContent.split(PROMPT_STOP_LABEL_PATTERN)[0] ?? "";
  const cleaned = stripAssistantPreamble(beforeMetadata);
  if (cleaned.length > 20) return cleaned;

  return normalizeValue(userPrompt);
};

export const isLikelyNegativeImagePrompt = (
  prompt: string,
  knownNegativePrompt?: string
) => {
  const normalizedPrompt = normalizeComparable(prompt);
  if (!normalizedPrompt) return false;
  if (
    knownNegativePrompt &&
    normalizedPrompt === normalizeComparable(knownNegativePrompt)
  ) {
    return true;
  }
  if (!NEGATIVE_PROMPT_PATTERN.test(prompt)) return false;
  const commaSeparatedParts = prompt.split(",").filter((part) => part.trim());
  return commaSeparatedParts.length >= 2 && prompt.length < 260;
};

export const repairImageToolArguments = (
  args: Record<string, unknown>,
  {
    assistantContent,
    userPrompt,
  }: {
    assistantContent: string;
    userPrompt: string;
  },
  {
    preferAssistantPrompt = false,
  }: {
    preferAssistantPrompt?: boolean;
  } = {}
) => {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const assistantPrompt = extractImagePromptForToolCall(assistantContent, userPrompt);
  const assistantNegativePrompt = extractNegativePromptFromAssistant(assistantContent);
  const repairedArgs = { ...args };

  const promptIsRawUserText =
    prompt && normalizeComparable(prompt) === normalizeComparable(userPrompt);

  if (
    assistantPrompt &&
    (!prompt ||
      isLikelyNegativeImagePrompt(prompt, assistantNegativePrompt) ||
      (preferAssistantPrompt && promptIsRawUserText))
  ) {
    repairedArgs.prompt = assistantPrompt;
    if (!repairedArgs.negative_prompt && prompt) {
      repairedArgs.negative_prompt = prompt;
    } else if (!repairedArgs.negative_prompt && assistantNegativePrompt) {
      repairedArgs.negative_prompt = assistantNegativePrompt;
    }
  }

  return repairedArgs;
};

export const parseToolArguments = (rawArgs: string) => {
  if (!rawArgs) return {};
  const parsed = JSON.parse(rawArgs);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid tool arguments.");
  }
  return parsed as Record<string, unknown>;
};

export const resolveToolArguments = ({
  toolName,
  rawArgs,
  context,
}: {
  toolName: string;
  rawArgs: string;
  context?: { assistantContent: string; userPrompt: string };
}) => {
  try {
    return { args: parseToolArguments(rawArgs), recovered: false };
  } catch (error) {
    if (toolName === "generate_image" && context) {
      return {
        args: {
          prompt: extractImagePromptForToolCall(
            context.assistantContent,
            context.userPrompt
          ),
        },
        recovered: true,
      };
    }
    throw error;
  }
};

export const normalizeImageToolModelRequest = ({
  requestedModel,
}: {
  requestedModel: string;
}) => {
  return requestedModel.trim();
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

export const sanitizeChatAttachmentAssets = (value: unknown): ChatAttachmentAsset[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const kind = record.kind;
      const name =
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : "";
      const mimeType =
        typeof record.mimeType === "string" && record.mimeType.trim()
          ? record.mimeType.trim()
          : kind === "pdf"
            ? "application/pdf"
            : kind === "image"
              ? "image/png"
              : "text/plain";
      const size =
        typeof record.size === "number" && Number.isFinite(record.size)
          ? record.size
          : undefined;
      const dataUrl =
        typeof record.dataUrl === "string" && record.dataUrl.trim()
          ? record.dataUrl.trim()
          : undefined;
      const text =
        typeof record.text === "string" && record.text.trim()
          ? record.text.trim()
          : undefined;
      const pagesRead =
        typeof record.pagesRead === "number" && Number.isFinite(record.pagesRead)
          ? record.pagesRead
          : undefined;
      const totalPages =
        typeof record.totalPages === "number" && Number.isFinite(record.totalPages)
          ? record.totalPages
          : undefined;
      const truncated =
        typeof record.truncated === "boolean" ? record.truncated : undefined;

      if (!id || !name) return null;
      if (kind !== "image" && kind !== "pdf" && kind !== "text") return null;
      if (kind === "image" && !dataUrl) return null;
      if ((kind === "pdf" || kind === "text") && !text) return null;

      return {
        id,
        kind,
        name,
        mimeType,
        ...(size !== undefined ? { size } : {}),
        ...(dataUrl ? { dataUrl } : {}),
        ...(text ? { text } : {}),
        ...(pagesRead !== undefined ? { pagesRead } : {}),
        ...(totalPages !== undefined ? { totalPages } : {}),
        ...(truncated !== undefined ? { truncated } : {}),
      };
    })
    .filter((entry): entry is ChatAttachmentAsset => !!entry);
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
  const activeModels = resolveActiveImageToolModels({
    pipelineEnabled: imagePipelineEnabled,
    preferredModels: imageModelOrder,
    fallbackModel: normalizedDefaultModel,
    availableModels,
  });

  if (!normalizedRequestedModel) return activeModels;

  const requestedIsAvailable = availableModels.includes(normalizedRequestedModel);
  if (!requestedIsAvailable) {
    return imagePipelineEnabled ? activeModels : [];
  }

  if (!imagePipelineEnabled) return [normalizedRequestedModel];

  if (normalizedRequestedModel === normalizedDefaultModel) {
    return activeModels;
  }

  return [
    normalizedRequestedModel,
    ...activeModels.filter((model) => model !== normalizedRequestedModel),
  ];
};

type ImageModelFallbackError = {
  model: string;
  reason: unknown;
};

type ImageModelFallbackUpdate<T> =
  | { model: string; status: "running" }
  | { model: string; status: "success"; value: T }
  | { model: string; status: "error"; error: unknown };

type ImageModelPipelineError = {
  model: string;
  reason: unknown;
  attempts: number;
};

type ImageModelPipelineUpdate<T> =
  | {
      model: string;
      status: "running";
      attempt: number;
      maxAttempts: number;
    }
  | {
      model: string;
      status: "success";
      value: T;
      attempt: number;
      maxAttempts: number;
    }
  | {
      model: string;
      status: "error";
      error: unknown;
      attempt: number;
      maxAttempts: number;
    };

type ImageModelPipelineSettled<T> =
  | { model: string; status: "fulfilled"; value: T }
  | {
      model: string;
      status: "rejected";
      reason: unknown;
      attempts: number;
    };

type ImageModelPipelineRunState = {
  attempt: number;
  maxAttempts: number;
};

export const runImageModelFallbackSequence = async <T>({
  models,
  runModel,
  onUpdate,
}: {
  models: string[];
  runModel: (model: string) => Promise<T>;
  onUpdate?: (update: ImageModelFallbackUpdate<T>) => void;
}): Promise<
  | {
      status: "fulfilled";
      model: string;
      value: T;
      errors: ImageModelFallbackError[];
    }
  | { status: "rejected"; errors: ImageModelFallbackError[] }
> => {
  const errors: ImageModelFallbackError[] = [];

  for (const model of models) {
    onUpdate?.({ model, status: "running" });
    try {
      const value = await runModel(model);
      onUpdate?.({ model, status: "success", value });
      return { status: "fulfilled", model, value, errors };
    } catch (error) {
      errors.push({ model, reason: error });
      onUpdate?.({ model, status: "error", error });
    }
  }

  return { status: "rejected", errors };
};

export const runImageModelPipelineParallel = async <T>({
  models,
  maxAttempts,
  runModel,
  onUpdate,
}: {
  models: string[];
  maxAttempts: unknown;
  runModel: (model: string, state: ImageModelPipelineRunState) => Promise<T>;
  onUpdate?: (update: ImageModelPipelineUpdate<T>) => void;
}): Promise<
  | {
      status: "fulfilled";
      values: Array<{ model: string; value: T }>;
      errors: ImageModelPipelineError[];
    }
  | { status: "rejected"; errors: ImageModelPipelineError[] }
> => {
  const settled: Array<ImageModelPipelineSettled<T>> = await Promise.all(
    models.map(async (model): Promise<ImageModelPipelineSettled<T>> => {
      let lastAttempt = 0;
      let configuredAttempts = 1;
      try {
        const value = await retryAsyncOperation({
          maxAttempts,
          onAttempt: ({ attempt, maxAttempts: attempts }) => {
            lastAttempt = attempt;
            configuredAttempts = attempts;
            onUpdate?.({
              model,
              status: "running",
              attempt,
              maxAttempts: attempts,
            });
          },
          run: async (state) => await runModel(model, state),
          onError: ({ attempt, maxAttempts: attempts, error, final }) => {
            lastAttempt = attempt;
            if (!final) return;
            onUpdate?.({
              model,
              status: "error",
              error,
              attempt,
              maxAttempts: attempts,
            });
          },
        });
        onUpdate?.({
          model,
          status: "success",
          value,
          attempt: lastAttempt,
          maxAttempts: configuredAttempts,
        });
        return { model, status: "fulfilled" as const, value };
      } catch (error) {
        return {
          model,
          status: "rejected" as const,
          reason: error,
          attempts: lastAttempt,
        };
      }
    })
  );

  const values = settled
    .filter((entry): entry is Extract<ImageModelPipelineSettled<T>, { status: "fulfilled" }> =>
      entry.status === "fulfilled"
    )
    .map((entry) => ({ model: entry.model, value: entry.value }));
  const errors = settled
    .filter((entry): entry is Extract<ImageModelPipelineSettled<T>, { status: "rejected" }> =>
      entry.status === "rejected"
    )
    .map(({ model, reason, attempts }) => ({ model, reason, attempts }));

  if (values.length) {
    return { status: "fulfilled", values, errors };
  }

  return { status: "rejected", errors };
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
  T extends { images?: unknown; media?: unknown; attachments?: unknown }
>(
  messages: T[],
  maxMessages: number
) =>
  messages.slice(-maxMessages).map((message) => {
    const clonedMessage = { ...message };
    delete clonedMessage.images;
    delete clonedMessage.media;
    delete clonedMessage.attachments;
    return clonedMessage;
  });
