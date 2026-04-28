import test from "node:test";
import assert from "node:assert/strict";

import { POST as navyChatPost } from "../../app/api/navy/chat/route.ts";

test("Navy chat route retries GLM 400s without reasoning content", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    requestBodies.push(body);

    if (requestBodies.length === 1) {
      return Response.json(
        { error: { message: "Upstream request failed." } },
        { status: 400 }
      );
    }

    return new Response("data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const response = await navyChatPost(
      new Request("https://studio.test/api/navy/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "glm-5.1-venice",
          messages: [
            { role: "user", content: "Generate an image." },
            {
              role: "assistant",
              content: "",
              reasoning_content: "Need image generation.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: "{\"prompt\":\"sky\"}",
                  },
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "generate_image",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          toolChoice: "auto",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-studio-chat-recovery"), "strip-reasoning");
    assert.equal(requestBodies.length, 2);
    assert.equal("tools" in requestBodies[1], true);
    const retryMessages = requestBodies[1].messages as Array<Record<string, unknown>>;
    assert.equal("reasoning_content" in (retryMessages[1] ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy chat route can fall back to text-only when tool envelope is rejected", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    requestBodies.push(body);

    if (requestBodies.length < 3) {
      return Response.json(
        { error: { message: "Unsupported tool schema." } },
        { status: 400 }
      );
    }

    return new Response("data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const response = await navyChatPost(
      new Request("https://studio.test/api/navy/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "glm-5.1-venice",
          messages: [{ role: "user", content: "Create an image prompt." }],
          tools: [
            {
              type: "function",
              function: {
                name: "generate_image",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          toolChoice: "auto",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-studio-chat-recovery"), "text-only");
    assert.equal(requestBodies.length, 3);
    assert.equal("tool_choice" in requestBodies[1], false);
    assert.equal("tools" in requestBodies[2], false);
    assert.equal("tool_choice" in requestBodies[2], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
