import {
  sanitizeChatAttachmentAssets,
  type ChatAttachmentAsset,
} from "./chat-media-persistence.ts";

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

const CHAT_RECOVERY_MAX_OUTPUT_TOKENS = 8_192;

const limitChatRecoveryOutputTokens = (
  payload: Record<string, unknown>
) => {
  const maxTokens = payload.max_tokens;
  if (
    typeof maxTokens !== "number" ||
    !Number.isFinite(maxTokens) ||
    maxTokens <= CHAT_RECOVERY_MAX_OUTPUT_TOKENS
  ) {
    return null;
  }

  const next = clonePayload(payload);
  next.max_tokens = CHAT_RECOVERY_MAX_OUTPUT_TOKENS;
  return next;
};

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

  const outputLimited = limitChatRecoveryOutputTokens(payload);
  addCandidate("limit-output-tokens", outputLimited);
  const compatibilityBase = outputLimited ?? payload;
  const withoutReasoning = stripReasoningContentFromChatPayload(
    compatibilityBase
  );
  const toolsRequireReasoningDisabled =
    providerRequiresReasoningDisabledForTools(providerError) &&
    Array.isArray(compatibilityBase.tools) &&
    compatibilityBase.tools.length > 0;

  if (toolsRequireReasoningDisabled) {
    if (compatibilityBase.reasoning_effort !== "none") {
      const reasoningDisabled = clonePayload(
        withoutReasoning ?? compatibilityBase
      );
      reasoningDisabled.reasoning_effort = "none";
      delete reasoningDisabled.thinking;
      addCandidate("disable-reasoning-for-tools", reasoningDisabled);
    }
    return candidates;
  }

  addCandidate("strip-reasoning", withoutReasoning);

  const reasoningBase = withoutReasoning ?? compatibilityBase;
  addCandidate(
    "omit-reasoning-controls",
    withoutPayloadFields(reasoningBase, ["reasoning_effort", "thinking"])
  );
  addCandidate("omit-sampling", withoutPayloadFields(reasoningBase, ["temperature"]));

  const toolChoiceBase = withoutReasoning ?? compatibilityBase;
  addCandidate("omit-tool-choice", withoutPayloadFields(toolChoiceBase, ["tool_choice"]));

  const textOnlyBase = withoutReasoning ?? compatibilityBase;
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
