type JsonRecord = Record<string, unknown>;

export type OpenAIResponsesPayloadInput = {
  model: string;
  messages: JsonRecord[];
  tools?: JsonRecord[];
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: unknown;
  stream?: boolean;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const routedModelId = (model: string) =>
  model
    .trim()
    .toLowerCase()
    .replace(/^(?:navyai|linkapi):/, "")
    .replace(/^openai[/:]/, "");

export const isOpenAIResponsesModel = (model: string) => {
  const normalized = routedModelId(model);
  if (/^ft:(?:gpt-|o\d+(?:[-.:]|$))/.test(normalized)) return true;
  if (
    /^(?:gpt-image-|dall-e-|tts-|whisper-|text-embedding-)/.test(normalized) ||
    /(?:-tts|-transcribe|-realtime)(?:[-.]|$)/.test(normalized)
  ) {
    return false;
  }
  return /^(?:gpt-|chatgpt-|o\d+(?:[-.]|$)|codex-|computer-use-)/.test(
    normalized
  );
};

export const isOpenAIReasoningModel = (model: string) => {
  const normalized = routedModelId(model);
  if (/^ft:/.test(normalized)) {
    return /(?:^|:)gpt-[5-9](?:[.-]|$)|(?:^|:)o\d+(?:[-.]|$)/.test(
      normalized
    );
  }
  return /^(?:gpt-[5-9](?:[.-]|$)|o\d+(?:[-.]|$))/.test(normalized);
};

export const shouldUseOpenAIResponses = (provider: string, model: string) =>
  (provider === "navy" || provider === "multillm") &&
  isOpenAIResponsesModel(model);

const contentText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const responseContentPart = (
  value: unknown,
  role: "user" | "system" | "developer" | "assistant"
) => {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  if (type === "text" || type === "input_text" || type === "output_text") {
    const text = contentText(value.text);
    return role === "assistant"
      ? { type: "output_text", text }
      : { type: "input_text", text };
  }
  if (role !== "assistant" && type === "image_url") {
    const image = isRecord(value.image_url) ? value.image_url : null;
    const imageUrl =
      typeof image?.url === "string"
        ? image.url
        : typeof value.image_url === "string"
          ? value.image_url
          : "";
    if (!imageUrl) return null;
    return {
      type: "input_image",
      image_url: imageUrl,
      ...(typeof image?.detail === "string" ? { detail: image.detail } : {}),
    };
  }
  if (
    role !== "assistant" &&
    (type === "input_image" || type === "input_file")
  ) {
    return value;
  }
  return null;
};

const responseMessageContent = (
  value: unknown,
  role: "user" | "system" | "developer" | "assistant"
) => {
  if (!Array.isArray(value)) return contentText(value);
  return value
    .map((part) => responseContentPart(part, role))
    .filter((part): part is NonNullable<typeof part> => part !== null);
};

const responseFunctionCalls = (message: JsonRecord) => {
  if (!Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.flatMap((value) => {
    if (!isRecord(value)) return [];
    const fn = isRecord(value.function) ? value.function : null;
    const callId = typeof value.id === "string" ? value.id : "";
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!callId || !name) return [];
    return [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: contentText(fn?.arguments || "{}"),
      },
    ];
  });
};

export const toOpenAIResponsesInput = (messages: JsonRecord[]) =>
  messages.flatMap((message) => {
    const role = typeof message.role === "string" ? message.role : "";
    if (role === "tool") {
      const callId =
        typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      return callId
        ? [
            {
              type: "function_call_output",
              call_id: callId,
              output: contentText(message.content),
            },
          ]
        : [];
    }
    if (
      role !== "user" &&
      role !== "system" &&
      role !== "developer" &&
      role !== "assistant"
    ) {
      return [];
    }

    const content = responseMessageContent(message.content, role);
    const hasContent = Array.isArray(content)
      ? content.length > 0
      : content.length > 0;
    const input: JsonRecord[] = hasContent ? [{ role, content }] : [];
    if (role === "assistant") {
      input.push(...responseFunctionCalls(message));
    }
    return input;
  });

const responseTools = (tools: JsonRecord[] | undefined) =>
  (tools ?? []).flatMap((tool) => {
    if (tool.type !== "function" || !isRecord(tool.function)) return [];
    const fn = tool.function;
    if (typeof fn.name !== "string" || !fn.name.trim()) return [];
    return [
      {
        type: "function",
        name: fn.name,
        ...(typeof fn.description === "string"
          ? { description: fn.description }
          : {}),
        parameters: isRecord(fn.parameters)
          ? fn.parameters
          : { type: "object", properties: {} },
        ...(typeof fn.strict === "boolean" ? { strict: fn.strict } : {}),
      },
    ];
  });

const responseToolChoice = (value: unknown) => {
  if (value === "auto" || value === "none" || value === "required") {
    return value;
  }
  if (!isRecord(value)) return undefined;
  const fn = isRecord(value.function) ? value.function : null;
  const name =
    typeof fn?.name === "string"
      ? fn.name
      : typeof value.toolName === "string"
        ? value.toolName
        : "";
  return name ? { type: "function", name } : undefined;
};

const responseReasoningEffort = (value: unknown) => {
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
  return value === "max" ? "xhigh" : undefined;
};

export const buildOpenAIResponsesPayload = ({
  model,
  messages,
  tools,
  toolChoice,
  maxTokens,
  temperature,
  reasoningEffort,
  stream = true,
}: OpenAIResponsesPayloadInput) => {
  const responseToolList = responseTools(tools);
  const normalizedReasoningEffort =
    responseReasoningEffort(reasoningEffort);
  const payload: JsonRecord = {
    model,
    input: toOpenAIResponsesInput(messages),
    stream,
    store: false,
  };

  if (responseToolList.length) {
    payload.tools = responseToolList;
    const normalizedToolChoice = responseToolChoice(toolChoice);
    if (normalizedToolChoice !== undefined) {
      payload.tool_choice = normalizedToolChoice;
    }
  }
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
    payload.max_output_tokens = maxTokens;
  }
  if (
    normalizedReasoningEffort !== undefined &&
    isOpenAIReasoningModel(model)
  ) {
    payload.reasoning = { effort: normalizedReasoningEffort };
  }
  if (
    typeof temperature === "number" &&
    Number.isFinite(temperature) &&
    (!isOpenAIReasoningModel(model) || normalizedReasoningEffort === "none")
  ) {
    payload.temperature = temperature;
  }

  return payload;
};

export const extractOpenAIResponseText = (value: unknown) => {
  if (!isRecord(value)) return "";
  if (typeof value.output_text === "string") return value.output_text.trim();
  if (!Array.isArray(value.output)) return "";
  return value.output
    .flatMap((item) =>
      isRecord(item) && Array.isArray(item.content) ? item.content : []
    )
    .flatMap((part) =>
      isRecord(part) && typeof part.text === "string" ? [part.text] : []
    )
    .join("")
    .trim();
};
