import {
  dynamicTool,
  jsonSchema,
  type ModelMessage,
  type ToolSet,
} from "ai";

import {
  isDeepSeekV4Model,
  normalizeDeepSeekReasoningEffort,
  normalizeDeepSeekThinkingType,
  normalizeReasoningEffort,
  shouldOmitToolChoiceForModel,
} from "./chat-tooling.ts";

export const AI_CHAT_TOOL_NAMES = [
  "generate_image",
  "generate_video",
  "generate_audio",
] as const;

export type AIChatToolName = (typeof AI_CHAT_TOOL_NAMES)[number];

const IMAGE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      description: "The final, production-ready image prompt.",
    },
    model: { type: "string", minLength: 1 },
    negative_prompt: { type: "string" },
    guidance_scale: { type: "number", minimum: 0 },
    width: { type: "integer", minimum: 64, maximum: 8192 },
    height: { type: "integer", minimum: 64, maximum: 8192 },
    resolution: {
      type: "string",
      description: "A supported resolution such as 1024x1024.",
    },
    size: {
      type: "string",
      description: "A supported output size such as 1024x1024.",
    },
    quality: {
      type: "string",
      enum: ["auto", "low", "medium", "high"],
    },
    style: {
      type: "string",
      description:
        "Only use when the selected image model documents a style parameter.",
    },
    image_url: {
      oneOf: [
        { type: "string", minLength: 1 },
        {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 5,
        },
      ],
      description: "Optional reference image URL, data URI, or image URL list.",
    },
    num_inference_steps: { type: "integer", minimum: 1, maximum: 200 },
    seed: { type: "integer" },
  },
  required: ["prompt"],
} as const;

const VIDEO_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      description: "The final video prompt.",
    },
    model: { type: "string", minLength: 1 },
    image: {
      type: "string",
      minLength: 1,
      description: "Optional or required source frame, depending on the model.",
    },
    image_url: {
      type: "string",
      minLength: 1,
      description: "Optional start-frame URL or data URI.",
    },
    size: {
      type: "string",
      description: "Output size or aspect ratio such as 16:9.",
    },
    seconds: { type: "number", minimum: 1, maximum: 60 },
    fps: { type: "number", minimum: 1, maximum: 120 },
    guidance_scale_2: { type: "number", minimum: 0 },
    seed: { type: "integer" },
  },
  required: ["prompt"],
} as const;

const AUDIO_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    input: {
      type: "string",
      minLength: 1,
      description: "Speech text for OpenAI-compatible TTS models.",
    },
    text: {
      type: "string",
      minLength: 1,
      description: "Speech text for Chutes voice models.",
    },
    model: { type: "string", minLength: 1 },
    voice: { type: "string", minLength: 1 },
    speed: { type: "number", minimum: 0.25, maximum: 4 },
    response_format: {
      type: "string",
      enum: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
    },
    speaker: { type: "integer", minimum: 0 },
    max_duration_ms: { type: "integer", minimum: 100, maximum: 600000 },
  },
  anyOf: [{ required: ["input"] }, { required: ["text"] }],
} as const;

const TOOL_DEFINITIONS = {
  generate_image: {
    description:
      "Generate or edit an image with the active ordered image pipeline. Omit model when uncertain so the configured pipeline order is used.",
    schema: IMAGE_TOOL_SCHEMA,
  },
  generate_video: {
    description:
      "Generate a short video. Include a source image for image-to-video models and omit it for text-to-video models.",
    schema: VIDEO_TOOL_SCHEMA,
  },
  generate_audio: {
    description:
      "Generate speech audio with the configured voice model. Use input for OpenAI-compatible TTS and text for Chutes voice models.",
    schema: AUDIO_TOOL_SCHEMA,
  },
} as const;

const isAIChatToolName = (value: unknown): value is AIChatToolName =>
  typeof value === "string" &&
  (AI_CHAT_TOOL_NAMES as readonly string[]).includes(value);

export const normalizeEnabledAIChatTools = (value: unknown): AIChatToolName[] => {
  const requested = new Set(
    Array.isArray(value) ? value.filter(isAIChatToolName) : []
  );
  return AI_CHAT_TOOL_NAMES.filter((name) => requested.has(name));
};

export const buildAIChatTools = (enabledTools: unknown): ToolSet => {
  const tools: ToolSet = {};
  for (const name of normalizeEnabledAIChatTools(enabledTools)) {
    const definition = TOOL_DEFINITIONS[name];
    tools[name] = dynamicTool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(
        definition.schema as unknown as Parameters<typeof jsonSchema>[0]
      ),
    });
  }
  return tools;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const messageText = (content: unknown) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
};

const imageURL = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ["data:", "http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
};

const toUserContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: URL; mediaType?: string }
  > = [];
  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push({ type: "text", text: record.text });
      continue;
    }
    if (record.type !== "image_url") continue;
    const image = asRecord(record.image_url);
    const url = imageURL(image?.url);
    if (!url) continue;
    const mediaType = url.protocol === "data:"
      ? /^data:([^;,]+)/i.exec(url.href)?.[1]
      : undefined;
    parts.push({
      type: "image",
      image: url,
      ...(mediaType ? { mediaType } : {}),
    });
  }
  return parts.length ? parts : messageText(content);
};

const parseToolInput = (value: unknown) => {
  if (typeof value !== "string") return asRecord(value) ?? {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
};

export const toAIModelMessages = (
  input: unknown
): ModelMessage[] => {
  if (!Array.isArray(input)) return [];
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();

  for (const value of input) {
    const message = asRecord(value);
    if (!message || typeof message.role !== "string") continue;

    if (message.role === "system") {
      messages.push({ role: "system", content: messageText(message.content) });
      continue;
    }

    if (message.role === "user") {
      messages.push({ role: "user", content: toUserContent(message.content) });
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "reasoning"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
      > = [];
      const content = messageText(message.content);
      if (content) parts.push({ type: "text", text: content });
      const reasoning =
        typeof message.reasoning_content === "string"
          ? message.reasoning_content
          : typeof message.reasoning === "string"
            ? message.reasoning
            : "";
      if (reasoning) parts.push({ type: "reasoning", text: reasoning });

      if (Array.isArray(message.tool_calls)) {
        for (const rawToolCall of message.tool_calls) {
          const toolCall = asRecord(rawToolCall);
          const fn = asRecord(toolCall?.function);
          const toolCallId =
            typeof toolCall?.id === "string" ? toolCall.id.trim() : "";
          const toolName = typeof fn?.name === "string" ? fn.name.trim() : "";
          if (!toolCallId || !toolName) continue;
          toolNames.set(toolCallId, toolName);
          parts.push({
            type: "tool-call",
            toolCallId,
            toolName,
            input: parseToolInput(fn?.arguments),
          });
        }
      }
      messages.push({
        role: "assistant",
        content: parts.length ? parts : "",
      });
      continue;
    }

    if (message.role === "tool") {
      const toolCallId =
        typeof message.tool_call_id === "string"
          ? message.tool_call_id.trim()
          : "";
      const explicitName =
        typeof message.name === "string" ? message.name.trim() : "";
      const toolName = explicitName || toolNames.get(toolCallId) || "";
      if (!toolCallId || !toolName) continue;
      const content = messageText(message.content);
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName,
            output: /^\s*tool error:/i.test(content)
              ? { type: "error-text", value: content }
              : { type: "text", value: content },
          },
        ],
      });
    }
  }
  return messages;
};

const isOpenAIReasoningModel = (model: string) => {
  const normalized = model.trim().toLowerCase();
  const modelId = normalized.split(/[/:]/).at(-1) ?? normalized;
  return /^(?:gpt-5(?:[.-]|$)|o\d+(?:[.-]|$))/.test(modelId);
};

const compactUndefined = (body: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );

export const normalizeAIChatRequestBody = ({
  model,
  body,
  thinking,
  reasoningEffort,
}: {
  model: string;
  body: Record<string, unknown>;
  thinking?: { type?: unknown };
  reasoningEffort?: unknown;
}) => {
  const next = compactUndefined({ ...body });
  const deepSeekV4 = isDeepSeekV4Model(model);
  const thinkingType = deepSeekV4
    ? normalizeDeepSeekThinkingType(thinking?.type)
    : null;

  if (shouldOmitToolChoiceForModel(model)) {
    delete next.tool_choice;
  }

  if (thinkingType) {
    next.thinking = { type: thinkingType };
    if (thinkingType === "enabled") {
      next.reasoning_effort = normalizeDeepSeekReasoningEffort(reasoningEffort);
    } else {
      delete next.reasoning_effort;
    }
  } else if (reasoningEffort !== undefined) {
    next.reasoning_effort = normalizeReasoningEffort(reasoningEffort);
  }

  if (
    (deepSeekV4 && thinkingType === "enabled") ||
    (!deepSeekV4 &&
      (reasoningEffort !== undefined || isOpenAIReasoningModel(model)))
  ) {
    delete next.temperature;
  }

  return compactUndefined(next);
};

export const normalizeAIChatToolChoice = (
  value: unknown,
  enabledTools: AIChatToolName[]
) => {
  if (!enabledTools.length) return undefined;
  if (value === "auto" || value === "none" || value === "required") {
    return value;
  }
  const record = asRecord(value);
  const fn = asRecord(record?.function);
  const name = fn?.name;
  if (isAIChatToolName(name) && enabledTools.includes(name)) {
    return { type: "tool" as const, toolName: name };
  }
  return "auto" as const;
};
