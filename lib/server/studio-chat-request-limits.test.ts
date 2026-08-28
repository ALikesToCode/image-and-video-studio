import assert from "node:assert/strict";
import test from "node:test";

import { POST as studioChatPost } from "../../app/api/studio/chat/route.ts";

test("Studio chat rejects oversized and structurally invalid requests", async () => {
  const oversized = await studioChatPost(
    new Request("https://studio.test/api/studio/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(72 * 1024 * 1024 + 1),
        "x-user-api-key": "secret",
      },
      body: "{}",
    }),
  );
  const nonObject = await studioChatPost(
    new Request("https://studio.test/api/studio/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-api-key": "secret",
      },
      body: "null",
    }),
  );
  const tooManyMessages = await studioChatPost(
    new Request("https://studio.test/api/studio/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-api-key": "secret",
      },
      body: JSON.stringify({
        provider: "chutes",
        model: "test-model",
        messages: Array.from({ length: 121 }, () => ({
          role: "user",
          content: "hello",
        })),
      }),
    }),
  );

  assert.equal(oversized.status, 413);
  assert.equal(nonObject.status, 400);
  assert.equal(tooManyMessages.status, 400);
});
