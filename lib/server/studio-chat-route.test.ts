import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from "ai";

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

const upstreamResponsesStream = (events: Record<string, unknown>[]) =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } }
  );

const completedResponsesEvent = () => ({
  type: "response.completed",
  response: {
    usage: {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 8,
      output_tokens_details: { reasoning_tokens: 0 },
    },
  },
});

const responsesTextEvents = (text: string, model: string) => [
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
    item: { type: "message", id: "msg_test" },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_test",
    delta: text,
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: { type: "message", id: "msg_test" },
  },
  completedResponsesEvent(),
];

const readUIChunks = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);

const readFinalUIMessage = async (response: Response) => {
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
    })
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
    return upstreamResponsesStream([
      ...responsesTextEvents(
        "I’ll generate that. ",
        "openai/gpt-5-mini"
      ).slice(0, -1),
      {
        type: "response.output_item.added",
        output_index: 1,
        item: {
          type: "function_call",
          id: "fc_image_1",
          call_id: "call_image_1",
          name: "generate_image",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_image_1",
        output_index: 1,
        delta: '{"prompt":"a moonlit harbor"}',
      },
      {
        type: "response.output_item.done",
        output_index: 1,
        item: {
          type: "function_call",
          id: "fc_image_1",
          call_id: "call_image_1",
          name: "generate_image",
          arguments: '{"prompt":"a moonlit harbor"}',
          status: "completed",
        },
      },
      completedResponsesEvent(),
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
    assert.equal(requests[0].url, "https://api.navy/v1/responses");
    assert.equal(requests[0].headers.get("authorization"), "Bearer navy-secret");
    assert.equal("temperature" in requests[0].body, false);
    assert.deepEqual(
      (requests[0].body.tools as Array<Record<string, unknown>>).map((tool) => {
        return tool.name;
      }),
      ["generate_image", "generate_video"]
    );
    assert.deepEqual(requests[0].body.tool_choice, {
      type: "function",
      name: "generate_image",
    });
    assert.equal(requests[0].body.max_output_tokens, 1024);
    assert.equal(requests[0].body.store, false);
    assert.deepEqual(requests[0].body.input, [
      { role: "developer", content: "Use tools when requested." },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Generate a harbor image." },
        ],
      },
    ]);
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

test("Studio chat keeps reasoning and tools together on the Responses API", async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls: string[] = [];
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    requestUrls.push(String(input));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestBodies.push(body);
    return upstreamResponsesStream(
      responsesTextEvents("Ready.", "gpt-5.6-terra")
    );
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
          model: "gpt-5.6-terra",
          messages: [{ role: "user", content: "Generate an image." }],
          enabledTools: ["generate_image"],
          toolChoice: {
            type: "function",
            function: { name: "generate_image" },
          },
          reasoningEffort: "high",
        }),
      })
    );
    await response.text();

    assert.deepEqual(requestUrls, ["https://api.navy/v1/responses"]);
    assert.equal(requestBodies.length, 1);
    assert.deepEqual(requestBodies[0].reasoning, {
      effort: "high",
      summary: "detailed",
    });
    assert.equal("tools" in requestBodies[0], true);
    assert.deepEqual(requestBodies[0].tool_choice, {
      type: "function",
      name: "generate_image",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat recovers NanoGPT tool calls that require reasoning disabled", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    url: string;
    body: Record<string, unknown>;
  }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (requests.length === 1) {
      return Response.json(
        {
          error: {
            message:
              "Function tools with reasoning_effort are incompatible for a future model. Set reasoning_effort to none to continue using tools.",
          },
        },
        { status: 422 }
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
          "x-user-api-key": "nano-secret",
        },
        body: JSON.stringify({
          provider: "nanogpt",
          model: "future-tool-reasoner",
          messages: [{ role: "user", content: "Generate an image." }],
          enabledTools: ["generate_image"],
          toolChoice: {
            type: "function",
            function: { name: "generate_image" },
          },
          reasoningEffort: "high",
        }),
      })
    );
    await response.text();

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://nano-gpt.com/api/v1/chat/completions");
    assert.equal(requests[1].body.reasoning_effort, "none");
    assert.equal("tools" in requests[1].body, true);
    assert.deepEqual(requests[1].body.tool_choice, {
      type: "function",
      function: { name: "generate_image" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat preserves unrelated NanoGPT errors without generic retries", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json(
      { error: { message: "Unrelated provider failure." } },
      { status: 422 }
    );
  };

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "nano-secret",
        },
        body: JSON.stringify({
          provider: "nanogpt",
          model: "future-tool-reasoner",
          messages: [{ role: "user", content: "Generate an image." }],
          enabledTools: ["generate_image"],
          reasoningEffort: "high",
        }),
      })
    );
    const chunks = await readUIChunks(response);
    const errorChunk = chunks.find((chunk) => chunk.type === "error");

    assert.equal(requestCount, 1);
    assert.match(String(errorChunk?.errorText), /Unrelated provider failure/);
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

test("Studio chat forwards remote image URLs without fetching them server-side", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  let upstreamBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url === "https://attacker.test/private.png") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      });
    }
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return upstreamStream([
      completionChunk({ role: "assistant", content: "I see it." }, "stop"),
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
          model: "vision-model",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this image." },
                {
                  type: "image_url",
                  image_url: {
                    url: "https://attacker.test/private.png",
                  },
                },
              ],
            },
          ],
        }),
      })
    );
    await response.text();

    assert.deepEqual(requestedUrls, [
      "https://llm.chutes.ai/v1/chat/completions",
    ]);
    const messages = upstreamBody.messages as Array<Record<string, unknown>>;
    const content = messages[0]?.content as Array<Record<string, unknown>>;
    assert.deepEqual(content[1], {
      type: "image_url",
      image_url: { url: "https://attacker.test/private.png" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat preserves Gemini thought signatures in provider history", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return upstreamStream([
      completionChunk({ role: "assistant", content: "Done." }, "stop"),
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
          provider: "navy",
          model: "google/gemini-3-flash",
          messages: [
            { role: "user", content: "Generate an image." },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: '{"prompt":"a lighthouse"}',
                  },
                  extra_content: {
                    google: {
                      thought_signature: "opaque-signature==",
                    },
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
        }),
      })
    );
    await response.text();

    const messages = upstreamBody.messages as Array<Record<string, unknown>>;
    const toolCalls = messages[1]?.tool_calls as Array<Record<string, unknown>>;
    assert.deepEqual(toolCalls[0]?.extra_content, {
      google: { thought_signature: "opaque-signature==" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat streams Gemini thought signatures into UI tool metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    upstreamStream([
      completionChunk(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_signed",
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
        "tool_calls"
      ),
    ]);

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "secret",
        },
        body: JSON.stringify({
          provider: "navy",
          model: "google/gemini-3-flash",
          messages: [{ role: "user", content: "Generate an image." }],
          enabledTools: ["generate_image"],
        }),
      })
    );
    const message = await readFinalUIMessage(response);
    const toolPart = message.parts.find(
      (part) =>
        part.type === "dynamic-tool" && part.toolCallId === "call_signed"
    );

    assert.ok(toolPart?.type === "dynamic-tool");
    assert.equal(toolPart.state, "input-available");
    assert.deepEqual(toolPart.callProviderMetadata, {
      navy: { thoughtSignature: "opaque-signature==" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat streams NanoGPT tools, usage, and Gemini signatures", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl = "";
  let upstreamHeaders = new Headers();
  let upstreamBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamHeaders = new Headers(init?.headers);
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return upstreamStream([
      completionChunk(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_nano_signed",
              type: "function",
              function: {
                name: "generate_image",
                arguments: '{"prompt":"a glass lighthouse"}',
              },
              extra_content: {
                google: { thought_signature: "new-nano-signature==" },
              },
            },
          ],
        },
        "tool_calls",
      ),
      JSON.stringify({
        id: "chatcmpl_usage",
        object: "chat.completion.chunk",
        created: 1,
        model: "google/gemini-3-flash-preview",
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 3,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 1 },
        },
      }),
    ]);
  };

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "nano-secret",
        },
        body: JSON.stringify({
          provider: "nanogpt",
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "user", content: "Generate an image." },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_previous",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: '{"prompt":"a previous lighthouse"}',
                  },
                  extra_content: {
                    google: { thought_signature: "old-nano-signature==" },
                  },
                },
              ],
            },
            {
              role: "tool",
              name: "generate_image",
              tool_call_id: "call_previous",
              content: "Generated 1 image.",
            },
          ],
          enabledTools: ["generate_image", "untrusted_tool"],
          tools: [
            {
              type: "function",
              function: { name: "untrusted_tool", parameters: {} },
            },
          ],
        }),
      }),
    );
    const messageResponse = response.clone();
    const chunks = await readUIChunks(response);
    const message = await readFinalUIMessage(messageResponse);

    assert.equal(upstreamUrl, "https://nano-gpt.com/api/v1/chat/completions");
    assert.equal(upstreamHeaders.get("authorization"), "Bearer nano-secret");
    assert.deepEqual(upstreamBody.stream_options, { include_usage: true });
    assert.deepEqual(
      (upstreamBody.tools as Array<Record<string, unknown>>).map((tool) =>
        (tool.function as Record<string, unknown>).name
      ),
      ["generate_image"],
    );
    const upstreamMessages = upstreamBody.messages as Array<
      Record<string, unknown>
    >;
    const previousToolCalls = upstreamMessages[1]
      ?.tool_calls as Array<Record<string, unknown>>;
    assert.deepEqual(previousToolCalls[0]?.extra_content, {
      google: { thought_signature: "old-nano-signature==" },
    });

    const toolPart = message.parts.find(
      (part) =>
        part.type === "dynamic-tool" &&
        part.toolCallId === "call_nano_signed",
    );
    assert.ok(toolPart?.type === "dynamic-tool");
    assert.deepEqual(toolPart.callProviderMetadata, {
      nanogpt: { thoughtSignature: "new-nano-signature==" },
    });
    const finish = chunks.find((chunk) => chunk.type === "finish");
    assert.deepEqual(finish?.messageMetadata, {
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
        cachedInputTokens: 2,
        reasoningTokens: 1,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat rejects schema-invalid tool input", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    upstreamStream([
      completionChunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_invalid",
            type: "function",
            function: {
              name: "generate_image",
              arguments: '{"prompt":"","width":8,"unexpected":true}',
            },
          },
        ],
      }, "tool_calls"),
    ]);

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
          messages: [{ role: "user", content: "Generate an image." }],
          enabledTools: ["generate_image"],
        }),
      })
    );
    const uiResponse = response.clone();
    const chunks = await readUIChunks(response);
    const invalidChunk = chunks.find(
      (chunk) =>
        chunk.type === "tool-input-error" &&
        chunk.toolCallId === "call_invalid"
    );
    const message = await readFinalUIMessage(uiResponse);
    const invalidPart = message.parts.find(
      (part) =>
        part.type === "dynamic-tool" && part.toolCallId === "call_invalid"
    );
    const outputErrorChunk = chunks.find(
      (chunk) =>
        chunk.type === "tool-output-error" &&
        chunk.toolCallId === "call_invalid"
    );

    assert.ok(invalidChunk);
    assert.equal(invalidChunk.toolName, "generate_image");
    assert.deepEqual(invalidChunk.input, {
      prompt: "",
      width: 8,
      unexpected: true,
    });
    assert.equal(
      invalidChunk.errorText,
      "The model called a tool with invalid inputs."
    );
    assert.deepEqual(outputErrorChunk, {
      type: "tool-output-error",
      toolCallId: "call_invalid",
      errorText: "Chat completion failed.",
      dynamic: true,
    });
    assert.equal(chunks.some((chunk) => chunk.type === "error"), false);
    assert.ok(invalidPart?.type === "dynamic-tool");
    assert.equal(invalidPart.state, "output-error");
    assert.deepEqual(invalidPart.input, {
      prompt: "",
      width: 8,
      unexpected: true,
    });
    assert.equal(invalidPart.errorText, "Chat completion failed.");
    assert.equal(
      chunks.some(
        (chunk) =>
          chunk.type === "tool-input-available" &&
          chunk.toolCallId === "call_invalid"
      ),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat only repairs double-encoded valid tool JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    upstreamStream([
      completionChunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_repaired",
            type: "function",
            function: {
              name: "generate_image",
              arguments: JSON.stringify('{"prompt":"a lighthouse"}'),
            },
          },
        ],
      }, "tool_calls"),
    ]);

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
          messages: [{ role: "user", content: "Generate an image." }],
          enabledTools: ["generate_image"],
        }),
      })
    );
    const chunks = await readUIChunks(response);
    const repaired = chunks.find(
      (chunk) =>
        chunk.type === "tool-input-available" &&
        chunk.toolCallId === "call_repaired"
    );

    assert.ok(repaired);
    assert.deepEqual(repaired.input, { prompt: "a lighthouse" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio chat routes MultiLLM through the configured proxy and server key", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MULTILLM_API_KEY;
  const originalBaseUrl = process.env.PROXY_BASE_URL;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  process.env.MULTILLM_API_KEY = "server-multillm-secret";
  process.env.PROXY_BASE_URL = "https://proxy.example.test";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return upstreamStream([
      completionChunk(
        { role: "assistant", content: "Proxy response." },
        "stop"
      ),
    ]);
  };

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "multillm",
          model: "opencode:deepseek-v4-flash",
          messages: [{ role: "user", content: "Hello." }],
          enabledTools: [],
        }),
      })
    );
    const chunks = await readUIChunks(response);

    assert.equal(response.status, 200);
    assert.equal(
      requests[0]?.url,
      "https://proxy.example.test/v1/chat/completions"
    );
    assert.equal(
      requests[0]?.authorization,
      "Bearer server-multillm-secret"
    );
    assert.ok(chunks.some((chunk) => chunk.type === "text-delta"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MULTILLM_API_KEY;
    else process.env.MULTILLM_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.PROXY_BASE_URL;
    else process.env.PROXY_BASE_URL = originalBaseUrl;
  }
});

test("Studio chat routes LinkAPI Luna through its provider-specific proxy path", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MULTILLM_API_KEY;
  const originalBaseUrl = process.env.PROXY_BASE_URL;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.MULTILLM_API_KEY = "server-multillm-secret";
  process.env.PROXY_BASE_URL = "https://proxy.example.test";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return upstreamResponsesStream(
      responsesTextEvents("Luna response.", "gpt-5.6-luna")
    );
  };

  try {
    const response = await studioChatPost(
      new Request("https://studio.test/api/studio/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "multillm",
          model: "linkapi:gpt-5.6-luna",
          messages: [{ role: "user", content: "Hello." }],
          enabledTools: [],
        }),
      })
    );
    const chunks = await readUIChunks(response);

    assert.equal(response.status, 200);
    assert.equal(
      requests[0]?.url,
      "https://proxy.example.test/linkapi/v1/responses"
    );
    assert.equal(requests[0]?.body.model, "gpt-5.6-luna");
    assert.deepEqual(requests[0]?.body.input, [
      {
        role: "user",
        content: [{ type: "input_text", text: "Hello." }],
      },
    ]);
    assert.equal(requests[0]?.body.store, false);
    assert.ok(chunks.some((chunk) => chunk.type === "text-delta"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MULTILLM_API_KEY;
    else process.env.MULTILLM_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.PROXY_BASE_URL;
    else process.env.PROXY_BASE_URL = originalBaseUrl;
  }
});
