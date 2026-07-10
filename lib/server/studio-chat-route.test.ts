import test from "node:test";
import assert from "node:assert/strict";

import { POST as studioChatPost } from "../../app/api/studio/chat/route.ts";

const completionChunk = (
  delta: Record<string, unknown>,
  finishReason: string | null = null
) =>
  JSON.stringify({
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });

const upstreamStream = (chunks: string[]) =>
  new Response(
    `${chunks.map((chunk) => `data: ${chunk}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } }
  );

const readUIChunks = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);

test("Studio chat uses AI SDK tool streaming and provider defaults", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return upstreamStream([
      completionChunk({ role: "assistant", content: "I’ll generate that. " }),
      completionChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_image_1",
            type: "function",
            function: {
              name: "generate_image",
              arguments: '{"prompt":"a moonlit',
            },
          },
        ],
      }),
      completionChunk(
        {
          tool_calls: [
            {
              index: 0,
              function: { arguments: ' harbor"}' },
            },
          ],
        },
        "tool_calls"
      ),
    ]);
  };

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
          model: "openai/gpt-5-mini",
          messages: [
            { role: "system", content: "Use tools when requested." },
            { role: "user", content: "Generate a harbor image." },
          ],
          enabledTools: ["generate_image", "generate_video"],
          toolChoice: {
            type: "function",
            function: { name: "generate_image" },
          },
          maxTokens: 1024,
          temperature: 0.7,
        }),
      })
    );
    const chunks = await readUIChunks(response);

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("x-vercel-ai-ui-message-stream"),
      "v1"
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.navy/v1/chat/completions");
    assert.equal(requests[0].headers.get("authorization"), "Bearer navy-secret");
    assert.equal("temperature" in requests[0].body, false);
    assert.deepEqual(
      (requests[0].body.tools as Array<Record<string, unknown>>).map((tool) => {
        const fn = tool.function as Record<string, unknown>;
        return fn.name;
      }),
      ["generate_image", "generate_video"]
    );
    assert.deepEqual(requests[0].body.tool_choice, {
      type: "function",
      function: { name: "generate_image" },
    });
    assert.ok(chunks.some((chunk) => chunk.type === "text-delta"));
    assert.ok(
      chunks.some(
        (chunk) =>
          chunk.type === "tool-input-available" &&
          chunk.toolCallId === "call_image_1" &&
          (chunk.input as Record<string, unknown>).prompt === "a moonlit harbor"
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat retries Navy reasoning envelopes without dropping tools", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestBodies.push(body);
    if (requestBodies.length === 1) {
      return Response.json(
        { error: { message: "Unsupported reasoning envelope." } },
        { status: 400 }
      );
    }
    return upstreamStream([
      completionChunk({ role: "assistant", content: "Recovered." }, "stop"),
    ]);
  };

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
          model: "glm-5.1-venice",
          messages: [
            { role: "user", content: "Generate an image." },
            {
              role: "assistant",
              content: "",
              reasoning_content: "Use the image tool.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: '{"prompt":"sky"}',
                  },
                },
              ],
            },
            {
              role: "tool",
              name: "generate_image",
              tool_call_id: "call_1",
              content: "Generated 1 image.",
            },
          ],
          enabledTools: ["generate_image"],
          toolChoice: "auto",
        }),
      })
    );
    await response.text();

    assert.equal(requestBodies.length, 2);
    assert.equal("tools" in requestBodies[1], true);
    const retryMessages = requestBodies[1]
      .messages as Array<Record<string, unknown>>;
    assert.equal("reasoning_content" in retryMessages[1], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat rejects unknown providers and never accepts client tool schemas", async () => {
  const rejected = await studioChatPost(
    new Request("https://studio.test/api/studio/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-api-key": "secret",
      },
      body: JSON.stringify({
        provider: "https://attacker.test/v1",
        model: "model",
        messages: [{ role: "user", content: "Hello" }],
      }),
    })
  );

  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: "Unsupported chat provider." });

  const originalFetch = globalThis.fetch;
  let upstreamBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return upstreamStream([
      completionChunk({ role: "assistant", content: "Hello" }, "stop"),
    ]);
  };
  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "secret",
        },
        body: JSON.stringify({
          provider: "chutes",
          model: "model",
          messages: [{ role: "user", content: "Hello" }],
          enabledTools: ["untrusted_tool"],
          tools: [
            {
              type: "function",
              function: { name: "untrusted_tool", parameters: {} },
            },
          ],
        }),
      })
    );
    await response.text();
    assert.equal("tools" in upstreamBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat emits redacted AI SDK stream errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Rejected Bearer navy-super-secret" } },
      { status: 401 }
    );

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-super-secret",
        },
        body: JSON.stringify({
          provider: "navy",
          model: "model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      })
    );
    const chunks = await readUIChunks(response);
    const errorChunk = chunks.find((chunk) => chunk.type === "error");

    assert.ok(errorChunk);
    assert.match(String(errorChunk.errorText), /\[redacted\]/i);
    assert.doesNotMatch(String(errorChunk.errorText), /navy-super-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
