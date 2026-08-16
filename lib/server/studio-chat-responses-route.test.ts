import assert from "node:assert/strict";
import test from "node:test";

import { POST as studioChatPost } from "../../app/api/studio/chat/route.ts";
import {
  completedResponsesEvent,
  readUIChunks,
  upstreamResponsesStream,
} from "./studio-chat-route-test-support.ts";

test("Studio chat repairs Luna tool arguments encoded as a JSON string", async () => {
  const originalFetch = globalThis.fetch;
  const encodedArguments = JSON.stringify(
    '{"prompt":"a moonlit harbor"}',
  );
  globalThis.fetch = async () =>
    upstreamResponsesStream([
      {
        type: "response.created",
        response: {
          id: "resp_luna_tool",
          created_at: 1,
          model: "gpt-5.6-luna",
        },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_luna_image",
          call_id: "call_luna_image",
          name: "generate_image",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_luna_image",
        output_index: 0,
        delta: encodedArguments,
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_luna_image",
          call_id: "call_luna_image",
          name: "generate_image",
          arguments: encodedArguments,
          status: "completed",
        },
      },
      completedResponsesEvent(),
    ]);

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          provider: "navy",
          model: "gpt-5.6-luna",
          messages: [
            {
              role: "user",
              content: "Generate a moonlit harbor image.",
            },
          ],
          enabledTools: ["generate_image"],
          toolChoice: {
            type: "function",
            function: { name: "generate_image" },
          },
        }),
      }),
    );
    const chunks = await readUIChunks(response);
    const repaired = chunks.find(
      (chunk) =>
        chunk.type === "tool-input-available" &&
        chunk.toolCallId === "call_luna_image",
    );

    assert.ok(repaired);
    assert.deepEqual(repaired.input, {
      prompt: "a moonlit harbor",
    });
    assert.equal(
      chunks.some(
        (chunk) =>
          chunk.type === "tool-input-error" &&
          chunk.toolCallId === "call_luna_image",
      ),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
