import assert from "node:assert/strict";
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from "ai";

export const completionChunk = (
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) =>
  JSON.stringify({
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  });

export const upstreamStream = (chunks: string[]) =>
  new Response(
    `${chunks
      .map((chunk) => `data: ${chunk}\n\n`)
      .join("")}data: [DONE]\n\n`,
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );

export const upstreamResponsesStream = (
  events: Record<string, unknown>[],
) =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );

export const completedResponsesEvent = () => ({
  type: "response.completed",
  response: {
    usage: {
      input_tokens: 12,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 8,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    },
  },
});

export const responsesTextEvents = (
  text: string,
  model: string,
) => [
  {
    type: "response.created",
    response: {
      id: "resp_test",
      created_at: 1,
      model,
    },
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: {
      type: "message",
      id: "msg_test",
    },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_test",
    delta: text,
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "message",
      id: "msg_test",
    },
  },
  completedResponsesEvent(),
];

export const readUIChunks = async (
  response: Response,
) =>
  (await response.text())
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("data: ") &&
        line !== "data: [DONE]",
    )
    .map(
      (line) =>
        JSON.parse(line.slice(6)) as Record<
          string,
          unknown
        >,
    );

export const readFinalUIMessage = async (
  response: Response,
) => {
  assert.ok(response.body);
  const chunks = parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!chunk.success) throw chunk.error;
        controller.enqueue(chunk.value);
      },
    }),
  );
  let finalMessage: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: chunks,
    terminateOnError: true,
  })) {
    finalMessage = message;
  }
  assert.ok(finalMessage);
  return finalMessage;
};
