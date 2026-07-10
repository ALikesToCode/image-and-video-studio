import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeChatMessages } from "../app/components/chutes-chat.tsx";

test("persisted chat history keeps bounded Gemini thought signatures", () => {
  assert.deepEqual(
    sanitizeChatMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "generate_image",
              arguments: '{"prompt":"a lighthouse"}',
            },
            extra_content: {
              google: { thought_signature: "opaque-signature==" },
            },
          },
        ],
      },
    ])[0]?.toolCalls,
    [
      {
        id: "call-1",
        type: "function",
        function: {
          name: "generate_image",
          arguments: '{"prompt":"a lighthouse"}',
        },
        extra_content: {
          google: { thought_signature: "opaque-signature==" },
        },
      },
    ]
  );
});

test("persisted chat history drops malformed thought-signature metadata", () => {
  const messages = sanitizeChatMessages([
    {
      id: "assistant-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          function: { name: "generate_image", arguments: "{}" },
          extra_content: { google: { thought_signature: 42 } },
        },
      ],
    },
  ]);

  assert.equal(messages[0]?.toolCalls?.[0]?.extra_content, undefined);
});
