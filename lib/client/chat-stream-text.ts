import { createParser, type EventSourceMessage } from "eventsource-parser";

import { isOutputTokenLimitReached } from "../llm-output-budget";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textFragment = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFragment).join("");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  return textFragment(value.content);
};

const chatCompletionText = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.choices)) return "";
  const choice = isRecord(value.choices[0]) ? value.choices[0] : null;
  const delta = isRecord(choice?.delta) ? choice.delta : null;
  const message = isRecord(choice?.message) ? choice.message : null;
  return textFragment(delta?.content) || textFragment(message?.content);
};

const responsesOutputText = (value: unknown) => {
  if (!isRecord(value)) return "";
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) return "";
  return value.output
    .flatMap((item) =>
      isRecord(item) && Array.isArray(item.content) ? item.content : []
    )
    .map(textFragment)
    .join("");
};

const completedResponseText = (value: JsonRecord) =>
  responsesOutputText(value.response) ||
  (value.type === "response.completed" ? responsesOutputText(value) : "");

export const readAssistantTextResponseResult = async (response: Response) => {
  if (!response.body) {
    throw new Error("No response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let streamedText = "";
  let completedText = "";
  let raw = "";
  let outputTokenLimitReached = false;
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      if (event.data === "[DONE]") return;
      try {
        const value = JSON.parse(event.data) as unknown;
        if (!isRecord(value)) return;
        outputTokenLimitReached =
          outputTokenLimitReached ||
          isOutputTokenLimitReached(value) ||
          isOutputTokenLimitReached(value.response);
        const eventType =
          typeof value.type === "string" ? value.type : event.event;
        if (
          eventType === "response.output_text.delta" &&
          typeof value.delta === "string"
        ) {
          streamedText += value.delta;
          return;
        }
        streamedText += chatCompletionText(value);
        if (!streamedText) {
          completedText =
            completedResponseText(value) ||
            (eventType === "response.output_text.done"
              ? textFragment(value.text)
              : completedText);
        }
      } catch {
        // A malformed event should not discard valid text from the rest of the stream.
      }
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      parser.feed(chunk);
    }
    const finalChunk = decoder.decode();
    if (finalChunk) {
      raw += finalChunk;
      parser.feed(finalChunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (streamedText.trim()) {
    return {
      text: streamedText.trim(),
      outputTokenLimitReached,
    };
  }
  if (completedText.trim()) {
    return {
      text: completedText.trim(),
      outputTokenLimitReached,
    };
  }

  const rawBody = raw.trim();
  if (!rawBody.startsWith("{")) {
    return { text: "", outputTokenLimitReached };
  }
  try {
    const value = JSON.parse(rawBody) as unknown;
    return {
      text: (chatCompletionText(value) || responsesOutputText(value)).trim(),
      outputTokenLimitReached:
        outputTokenLimitReached || isOutputTokenLimitReached(value),
    };
  } catch {
    return { text: "", outputTokenLimitReached };
  }
};

export const readAssistantTextResponse = async (response: Response) =>
  (await readAssistantTextResponseResult(response)).text;
