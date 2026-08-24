import assert from "node:assert/strict";
import test from "node:test";

import {
  readAssistantTextResponse,
  readAssistantTextResponseResult,
} from "./chat-stream-text";

const sseResponse = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });

test("reads Chat Completions text deltas", async () => {
  const response = sseResponse(
    [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")
  );

  assert.equal(await readAssistantTextResponse(response), "Hello world");
});

test("reads typed Responses API text deltas without duplicating completed text", async () => {
  const response = sseResponse(
    [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":" world"}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Hello world"}]}]}}',
      "",
    ].join("\n")
  );

  assert.equal(await readAssistantTextResponse(response), "Hello world");
});

test("reads a non-streaming Responses API body", async () => {
  const response = Response.json({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "Recovered prompt" }],
      },
    ],
  });

  assert.equal(await readAssistantTextResponse(response), "Recovered prompt");
});

test("reports a Chat Completions length stop without discarding its text", async () => {
  const response = sseResponse(
    [
      'data: {"choices":[{"delta":{"content":"Partial prompt"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")
  );

  assert.deepEqual(await readAssistantTextResponseResult(response), {
    text: "Partial prompt",
    outputTokenLimitReached: true,
  });
});

test("reports an incomplete Responses API stream", async () => {
  const response = sseResponse(
    [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"Partial prompt"}',
      "",
      "event: response.incomplete",
      'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
      "",
      "",
    ].join("\n")
  );

  assert.deepEqual(await readAssistantTextResponseResult(response), {
    text: "Partial prompt",
    outputTokenLimitReached: true,
  });
});
