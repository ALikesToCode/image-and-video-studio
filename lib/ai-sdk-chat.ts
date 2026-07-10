import {
  asSchema,
  dynamicTool,
  jsonSchema,
  type ModelMessage,
  type ToolCallRepairFunction,
  type ToolSet,
  type UIMessage,
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

export type AIChatToolCall = {
  id: string;
  type: "function";
  input_error?: string;
  function: {
    name: string;
    arguments: string;
  };
  extra_content?: {
    google?: {
      thought_signature?: string;
    };
  };
};

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
  anyOf: [
    { type: "object", required: ["input"] },
    { type: "object", required: ["text"] },
  ],
} as const;

const TOOL_DEFINITIONS = {
  generate_image: {
    description:
      "Use only when the user wants an image created or edited now. This is not for writing or improving an image prompt, explaining image generation, comparing models, or when an image is only source material or context. Use the active ordered image pipeline and omit model when uncertain so the configured pipeline order is used.",
    schema: IMAGE_TOOL_SCHEMA,
  },
  generate_video: {
    description:
      "Use only when the user wants a video created or edited now, not when video is only source material or context. Include a source image for image-to-video models and omit it for text-to-video models.",
    schema: VIDEO_TOOL_SCHEMA,
  },
  generate_audio: {
    description:
      "Use only when the user wants speech audio created now, not when audio is only source material or context. Use the configured voice model, input for OpenAI-compatible TTS, and text for Chutes voice models.",
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

type JSONSchemaRecord = Record<string, unknown>;

const schemaRecord = (value: unknown): JSONSchemaRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONSchemaRecord)
    : null;

const validateSchemaValue = (
  schemaValue: unknown,
  value: unknown,
  path = "$"
): string[] => {
  const schema = schemaRecord(schemaValue);
  if (!schema) return [`${path} has an invalid schema.`];

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => validateSchemaValue(candidate, value, path).length === 0
    ).length;
    if (matches !== 1) return [`${path} must match exactly one allowed shape.`];
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.some(
      (candidate) => validateSchemaValue(candidate, value, path).length === 0
    );
    if (!matches) return [`${path} must match an allowed shape.`];
  }

  const type = schema.type;
  if (type === "object") {
    const record = schemaRecord(value);
    if (!record) return [`${path} must be an object.`];
    const properties = schemaRecord(schema.properties) ?? {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    const errors = required
      .filter((key) => !(key in record))
      .map((key) => `${path}.${key} is required.`);
    if (schema.additionalProperties === false) {
      errors.push(
        ...Object.keys(record)
          .filter((key) => !(key in properties))
          .map((key) => `${path}.${key} is not allowed.`)
      );
    }
    for (const [key, childValue] of Object.entries(record)) {
      if (key in properties) {
        errors.push(
          ...validateSchemaValue(properties[key], childValue, `${path}.${key}`)
        );
      }
    }
    return errors;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array.`];
    const errors: string[] = [];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s).`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(
          ...validateSchemaValue(schema.items, item, `${path}[${index}]`)
        );
      });
    }
    return errors;
  }

  if (type === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return [`${path} must contain at least ${schema.minLength} character(s).`];
    }
  } else if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return [`${path} must be an integer.`];
    }
  } else if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return [`${path} must be a finite number.`];
    }
  } else if (type === "boolean" && typeof value !== "boolean") {
    return [`${path} must be a boolean.`];
  }

  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must use an allowed value.`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}.`);
    }
  }
  return errors;
};

const validatedJSONSchema = (schema: JSONSchemaRecord) =>
  jsonSchema<Record<string, unknown>>(
    schema as Parameters<typeof jsonSchema>[0],
    {
      validate: (value) => {
        const errors = validateSchemaValue(schema, value);
        return errors.length
          ? { success: false as const, error: new Error(errors.join(" ")) }
          : {
              success: true as const,
              value: value as Record<string, unknown>,
            };
      },
    }
  );

export const buildAIChatTools = (enabledTools: unknown): ToolSet => {
  const tools: ToolSet = {};
  for (const name of normalizeEnabledAIChatTools(enabledTools)) {
    const definition = TOOL_DEFINITIONS[name];
    tools[name] = dynamicTool({
      description: definition.description,
      inputSchema: validatedJSONSchema(
        definition.schema as unknown as JSONSchemaRecord
      ),
    });
  }
  return tools;
};

export const repairAIChatToolCall: ToolCallRepairFunction<ToolSet> = async ({
  toolCall,
  tools,
}) => {
  if (!isAIChatToolName(toolCall.toolName)) return null;
  const tool = tools[toolCall.toolName];
  if (!tool || !("inputSchema" in tool)) return null;

  let encodedInput: unknown;
  try {
    encodedInput = JSON.parse(toolCall.input) as unknown;
  } catch {
    return null;
  }
  if (typeof encodedInput !== "string") return null;

  let decodedInput: unknown;
  try {
    decodedInput = JSON.parse(encodedInput) as unknown;
  } catch {
    return null;
  }
  const schema = asSchema(tool.inputSchema);
  if (!schema.validate) return null;
  const validation = await schema.validate(decodedInput);
  if (!validation.success) return null;

  return {
    ...toolCall,
    input: JSON.stringify(validation.value),
  };
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
    | { type: "file"; data: URL; mediaType: string }
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
      type: "file",
      data: url,
      mediaType: mediaType ?? "image",
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

const thoughtSignatureFromMetadata = (value: unknown) => {
  const metadata = asRecord(value);
  if (!metadata) return null;
  for (const key of [
    "google",
    "navy",
    "chutes",
    "nanogpt",
    "openaiCompatible",
  ]) {
    const options = asRecord(metadata[key]);
    if (typeof options?.thoughtSignature === "string") {
      return options.thoughtSignature;
    }
  }
  return null;
};

const thoughtSignatureFromToolCall = (value: Record<string, unknown>) => {
  const extraContent = asRecord(value.extra_content);
  const google = asRecord(extraContent?.google);
  if (typeof google?.thought_signature === "string") {
    return google.thought_signature;
  }
  return thoughtSignatureFromMetadata(value.callProviderMetadata);
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
            providerOptions?: {
              google: { thoughtSignature: string };
            };
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
          if (!toolCall) continue;
          const fn = asRecord(toolCall.function);
          const toolCallId =
            typeof toolCall.id === "string" ? toolCall.id.trim() : "";
          const toolName = typeof fn?.name === "string" ? fn.name.trim() : "";
          if (!toolCallId || !toolName) continue;
          const thoughtSignature = thoughtSignatureFromToolCall(toolCall);
          toolNames.set(toolCallId, toolName);
          parts.push({
            type: "tool-call",
            toolCallId,
            toolName,
            input: parseToolInput(fn?.arguments),
            ...(thoughtSignature !== null
              ? {
                  providerOptions: {
                    google: { thoughtSignature },
                  },
                }
              : {}),
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

export const extractAIChatStreamState = (message: UIMessage) => {
  const content: string[] = [];
  const thinking: string[] = [];
  const toolCalls: AIChatToolCall[] = [];
  const toolErrors: string[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      content.push(part.text);
      continue;
    }
    if (part.type === "reasoning") {
      thinking.push(part.text);
      continue;
    }
    if (part.type !== "dynamic-tool") continue;
    if (part.state === "output-error") {
      const thoughtSignature = thoughtSignatureFromMetadata(
        part.callProviderMetadata
      );
      toolCalls.push({
        id: part.toolCallId,
        type: "function",
        input_error:
          part.errorText || `Invalid arguments for ${part.toolName}.`,
        function: {
          name: part.toolName,
          arguments: JSON.stringify(part.input ?? {}),
        },
        ...(thoughtSignature !== null
          ? {
              extra_content: {
                google: { thought_signature: thoughtSignature },
              },
            }
          : {}),
      });
      continue;
    }
    if (part.state !== "input-available") continue;
    const thoughtSignature = thoughtSignatureFromMetadata(
      part.callProviderMetadata
    );
    toolCalls.push({
      id: part.toolCallId,
      type: "function",
      function: {
        name: part.toolName,
        arguments: JSON.stringify(part.input ?? {}),
      },
      ...(thoughtSignature !== null
        ? {
            extra_content: {
              google: { thought_signature: thoughtSignature },
            },
          }
        : {}),
    });
  }

  return {
    content: content.join(""),
    thinking: thinking.join(""),
    toolCalls,
    toolErrors,
  };
};

export const chatModelToolSupport = (
  model:
    | {
        supportsTools?: boolean | null;
        supportsFunctionCalling?: boolean | null;
      }
    | undefined
) => {
  if (
    model?.supportsTools === true ||
    model?.supportsFunctionCalling === true
  ) {
    return true;
  }
  if (
    model?.supportsTools === false ||
    model?.supportsFunctionCalling === false
  ) {
    return false;
  }
  return null;
};
