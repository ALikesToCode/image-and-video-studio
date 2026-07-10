import type {
  ChatProvider,
  ModelOption,
  ModelParameterValue,
  Provider,
} from "./constants.ts";
import {
  buildModelParameterPayload,
  resolveModelParameterValues,
} from "./model-capability-settings.ts";
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

export type ChatImageAsset = {
  id: string;
  dataUrl: string;
  mimeType: string;
  model?: string;
  provider?: Provider;
};

export type ChatMediaAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  dataUrl: string;
  mimeType: string;
  model?: string;
};

export type ChatMediaPreview = {
  imageUrl: string;
  prompt: string;
  model: string;
  provider: string;
  kind: ChatMediaAsset["kind"];
  mimeType: string | null;
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

const toolStringArgument = (
  args: Record<string, unknown>,
  keys: string[],
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const toolNumberArgument = (
  args: Record<string, unknown>,
  keys: string[],
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const toolImageArguments = (args: Record<string, unknown>) => {
  const value = args.image_url ?? args.image;
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizedModalities = (value?: string[] | null) =>
  (value ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);

export const isChatVideoModelSupported = (model: ModelOption) => {
  if (model.provider !== "nanogpt") return true;
  const inputModalities = normalizedModalities(model.inputModalities);
  const outputModalities = normalizedModalities(model.outputModalities);
  if (inputModalities.some((entry) => entry === "video" || entry === "audio")) {
    return false;
  }
  const producesVideo =
    model.supports?.video === true || outputModalities.includes("video");
  const acceptsSupportedInput =
    model.supports?.textToVideo === true ||
    model.supports?.imageToVideo === true ||
    inputModalities.some((entry) => entry === "text" || entry === "image") ||
    inputModalities.length === 0;
  return producesVideo && acceptsSupportedInput;
};

export const buildNanoGptImageToolRequest = ({
  model,
  prompt,
  args,
}: {
  model: ModelOption;
  prompt: string;
  args: Record<string, unknown>;
}) => {
  const requestedResolution = toolStringArgument(args, ["resolution", "size"]);
  const supportedResolutions = model.supportedResolutions ?? [];
  const resolution = requestedResolution || supportedResolutions[0];
  const supportsReferenceImages =
    model.supports?.referenceImages === true ||
    (model.supports?.referenceImages !== false &&
      (typeof model.maxReferenceImages === "number" ||
        normalizedModalities(model.inputModalities).includes("image")));
  const maxReferenceImages = supportsReferenceImages
    ? Math.max(0, model.maxReferenceImages ?? 1)
    : 0;
  const references = toolImageArguments(args).slice(0, maxReferenceImages);
  const quality = toolStringArgument(args, ["quality"]);
  const seed = toolNumberArgument(args, ["seed"]);
  const fixedOutputImages =
    typeof model.fixedOutputImages === "number" && model.fixedOutputImages > 0
      ? Math.round(model.fixedOutputImages)
      : undefined;

  return {
    model: model.id,
    prompt,
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {}),
    ...(model.supports?.seed === true && seed !== undefined
      ? { seed: Math.round(seed) }
      : {}),
    numberOfImages: fixedOutputImages ?? 1,
    ...(references.length ? { input_references: references } : {}),
    modelCapabilities: {
      supportedResolutions,
      maxOutputImages: model.maxOutputImages,
      fixedOutputImages: model.fixedOutputImages,
      maxReferenceImages,
      supportsReferenceImages,
    },
  };
};

const nanoVideoParameterArgument = (
  parameterName: string,
  args: Record<string, unknown>,
) => {
  const normalized = parameterName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/duration|seconds|length/.test(normalized)) {
    return toolNumberArgument(args, ["seconds"]);
  }
  if (/aspectratio|ratio/.test(normalized)) {
    return toolStringArgument(args, ["size"]);
  }
  if (/resolution|size/.test(normalized)) {
    return toolStringArgument(args, ["size"]);
  }
  if (/guidance/.test(normalized)) {
    return toolNumberArgument(args, ["guidance_scale_2"]);
  }
  if (normalized === "fps" || normalized.endsWith("fps")) {
    return toolNumberArgument(args, ["fps"]);
  }
  if (normalized === "seed" || normalized.endsWith("seed")) {
    return toolNumberArgument(args, ["seed"]);
  }
  return undefined;
};

export const buildNanoGptVideoToolRequest = ({
  model,
  prompt,
  sourceImage,
  args,
}: {
  model: ModelOption;
  prompt: string;
  sourceImage?: string;
  args: Record<string, unknown>;
}) => {
  const dynamicValues: Record<string, ModelParameterValue> = {};
  for (const key of Object.keys(model.dynamicParameters ?? {})) {
    const value = nanoVideoParameterArgument(key, args);
    if (value !== undefined) dynamicValues[key] = value;
  }
  let parameters = buildModelParameterPayload(
    model,
    resolveModelParameterValues(model, dynamicValues),
  );
  if (!Object.keys(model.dynamicParameters ?? {}).length) {
    const seconds = toolNumberArgument(args, ["seconds"]);
    const size = toolStringArgument(args, ["size"]);
    const fps = toolNumberArgument(args, ["fps"]);
    const guidance = toolNumberArgument(args, ["guidance_scale_2"]);
    const seed = toolNumberArgument(args, ["seed"]);
    parameters = {
      ...(seconds !== undefined ? { duration: seconds } : {}),
      ...(size
        ? size.includes(":")
          ? { aspect_ratio: size }
          : { resolution: size }
        : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(guidance !== undefined ? { guidance_scale_2: guidance } : {}),
      ...(seed !== undefined ? { seed: Math.round(seed) } : {}),
    };
  }
  const acceptsSourceImage =
    model.supports?.sourceImage === true ||
    model.supports?.imageToVideo === true ||
    (model.supports?.sourceImage !== false &&
      normalizedModalities(model.inputModalities).includes("image"));
  return {
    model: model.id,
    prompt,
    parameters,
    ...(acceptsSourceImage && sourceImage ? { sourceImage } : {}),
  };
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

const isOpenAiDefaultTemperatureModel = (model: string) => {
  const normalized = model.trim().toLowerCase();
  const modelId = normalized.split(/[/:]/).at(-1) ?? normalized;
  return /^(?:gpt-5(?:[.-]|$)|o\d+(?:[.-]|$))/.test(modelId);
};

export const buildChatMediaPreview = ({
  item,
  prompt,
  provider,
}: {
  item: ChatMediaAsset;
  prompt?: string | null;
  provider?: string | null;
}): ChatMediaPreview => ({
  imageUrl: item.dataUrl,
  prompt: prompt?.trim() ?? "",
  model: item.model ?? "",
  provider: provider?.trim() ?? "",
  kind: item.kind,
  mimeType: item.mimeType || null,
});

export const resolveNavyVideoStartResult = (value: unknown) => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    videoUrl:
      typeof record.videoUrl === "string" ? record.videoUrl.trim() : "",
    jobId: typeof record.id === "string" ? record.id.trim() : "",
  };
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
  const usesDefaultTemperature =
    (isDeepSeekV4 && thinkingType === "enabled") ||
    (!isDeepSeekV4 &&
      (hasReasoningEffort || isOpenAiDefaultTemperatureModel(model)));
  if (
    typeof temperature === "number" &&
    Number.isFinite(temperature) &&
    !usesDefaultTemperature
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

const primaryProviderErrorText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as Record<string, unknown>;
  const nestedError = record.error;
  if (typeof nestedError === "string") return nestedError;
  if (
    nestedError &&
    typeof nestedError === "object" &&
    !Array.isArray(nestedError)
  ) {
    const nestedRecord = nestedError as Record<string, unknown>;
    if (typeof nestedRecord.message === "string") return nestedRecord.message;
    if (typeof nestedRecord.detail === "string") return nestedRecord.detail;
  }
  if (typeof record.message === "string") return record.message;
  if (typeof record.detail === "string") return record.detail;
  return "";
};

const providerRequiresReasoningDisabledForTools = (value: unknown) => {
  const message = primaryProviderErrorText(value);
  const mentionsTools =
    /\b(?:function\s+(?:tools?|calling)|tools?|tool\s+(?:calls?|use))\b/i.test(
      message
    );
  const requiresNone =
    /\b(?:set|use)\s+(?:the\s+)?reasoning[_\s-]*effort\b[^.!?\n]{0,32}\bnone\b/i.test(
      message
    ) ||
    /\breasoning[_\s-]*effort\b[^.!?\n]{0,48}\b(?:must|should|needs?\s+to|required\s+to|can\s+only)\b[^.!?\n]{0,32}\bnone\b/i.test(
      message
    );
  return mentionsTools && requiresNone;
};

export const buildChatCompletionRecoveryPayloads = (
  payload: Record<string, unknown>,
  { providerError }: { providerError?: unknown } = {}
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
  const toolsRequireReasoningDisabled =
    providerRequiresReasoningDisabledForTools(providerError) &&
    Array.isArray(payload.tools) &&
    payload.tools.length > 0;

  if (toolsRequireReasoningDisabled) {
    if (payload.reasoning_effort !== "none") {
      const reasoningDisabled = clonePayload(withoutReasoning ?? payload);
      reasoningDisabled.reasoning_effort = "none";
      delete reasoningDisabled.thinking;
      addCandidate("disable-reasoning-for-tools", reasoningDisabled);
    }
    return candidates;
  }

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
      const provider =
        imgRecord.provider === "gemini" ||
        imgRecord.provider === "navy" ||
        imgRecord.provider === "chutes" ||
        imgRecord.provider === "openrouter" ||
        imgRecord.provider === "nanogpt"
          ? imgRecord.provider
          : undefined;
      if (!id || !dataUrl) return null;
      return {
        id,
        dataUrl,
        mimeType,
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
      };
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
