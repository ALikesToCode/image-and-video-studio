import test from "node:test";
import assert from "node:assert/strict";

import { selectChatContextMessages } from "./chat-context-budget.ts";

const message = (
  role: "user" | "assistant" | "tool",
  content: string,
  extra: Record<string, unknown> = {},
) => ({ role, content, ...extra });

test("keeps the newest complete user turns within the message budget", () => {
  const messages = [
    message("user", "old question"),
    message("assistant", "old answer"),
    message("user", "recent question"),
    message("assistant", "tool call", {
      toolCalls: [{ id: "call-1", function: { name: "generate_image" } }],
    }),
    message("tool", "tool result"),
    message("assistant", "recent answer"),
  ];

  assert.deepEqual(
    selectChatContextMessages(messages, {
      maxMessages: 4,
      maxCharacters: 1_000,
    }),
    messages.slice(2),
  );
});

test("never starts the selected context with an orphan assistant or tool message", () => {
  const messages = [
    message("assistant", "orphan assistant"),
    message("tool", "orphan tool"),
    message("user", "first valid turn"),
    message("assistant", "first answer"),
    message("user", "latest turn"),
  ];

  const selected = selectChatContextMessages(messages, {
    maxMessages: 1,
    maxCharacters: 1_000,
  });

  assert.deepEqual(selected, [messages[4]]);
  assert.equal(selected[0]?.role, "user");
});

test("always preserves the latest turn when it alone exceeds the character budget", () => {
  const latest = message("user", "x".repeat(200));
  assert.deepEqual(
    selectChatContextMessages(
      [message("user", "old"), message("assistant", "answer"), latest],
      { maxMessages: 8, maxCharacters: 20 },
    ),
    [latest],
  );
});

test("counts attachment text and excludes transient status messages", () => {
  const messages = [
    message("user", "old", {
      attachments: [{ text: "x".repeat(80) }],
    }),
    message("assistant", "old answer"),
    message("user", "latest"),
    message("tool", "Invoking generate_image...", { transient: true }),
  ];

  assert.deepEqual(
    selectChatContextMessages(messages, {
      maxMessages: 8,
      maxCharacters: 50,
    }),
    [messages[2]],
  );
});
