import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAIChatTools,
  chatModelToolSupport,
  extractAIChatStreamState,
  normalizeAIChatRequestBody,
  toAIModelMessages,
} from "./ai-sdk-chat.ts";
import { asSchema } from "ai";

test("AI SDK chat messages preserve reasoning, tool calls, and matching results", () => {
  const messages = toAIModelMessages([
    { role: "system", content: "Be concise." },
    {
      role: "assistant",
      content: "",
      reasoning_content: "An image tool is appropriate.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "generate_image",
            arguments: '{"prompt":"a blue hour skyline"}',
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
  ]);

  assert.deepEqual(messages, [
    { role: "system", content: "Be concise." },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "An image tool is appropriate." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "generate_image",
          input: { prompt: "a blue hour skyline" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "generate_image",
          output: { type: "text", value: "Generated 1 image." },
        },
      ],
    },
  ]);
});

test("AI SDK chat messages preserve OpenAI-compatible image attachments", () => {
  const messages = toAIModelMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this." },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,YWJj" },
        },
      ],
    },
  ]);

  assert.equal(messages[0]?.role, "user");
  assert.ok(Array.isArray(messages[0]?.content));
  const content = messages[0]?.content;
  assert.equal(Array.isArray(content) ? content[0]?.type : null, "text");
  assert.equal(Array.isArray(content) ? content[1]?.type : null, "file");
  assert.equal(
    Array.isArray(content) && content[1]?.type === "file"
      ? String(content[1].data)
      : "",
    "data:image/png;base64,YWJj"
  );
});

test("AI SDK chat messages discard unsafe and malformed image attachments", () => {
  const messages = toAIModelMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "Describe only safe attachments." },
        { type: "image_url", image_url: { url: "file:///tmp/private.png" } },
        { type: "image_url", image_url: { url: "http://example.com/image.png" } },
        {
          type: "image_url",
          image_url: { url: "data:image/svg+xml;base64,AQID" },
        },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,not-valid!" },
        },
      ],
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [{ type: "text", text: "Describe only safe attachments." }],
    },
  ]);
});

test("AI SDK request normalization preserves defaults and DeepSeek tool support", () => {
  assert.deepEqual(
    normalizeAIChatRequestBody({
      model: "openai/gpt-5-mini",
      body: {
        model: "openai/gpt-5-mini",
        temperature: 0.7,
        tool_choice: "auto",
      },
    }),
    {
      model: "openai/gpt-5-mini",
      tool_choice: "auto",
    }
  );

  assert.deepEqual(
    normalizeAIChatRequestBody({
      model: "deepseek-v4-pro",
      body: {
        model: "deepseek-v4-pro",
        temperature: 0.7,
        tool_choice: "auto",
        tools: [{ type: "function" }],
      },
      thinking: { type: "enabled" },
      reasoningEffort: "max",
    }),
    {
      model: "deepseek-v4-pro",
      tools: [{ type: "function" }],
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    }
  );
});

test("AI SDK tools are server-owned and restricted to the supported allowlist", () => {
  const tools = buildAIChatTools([
    "generate_image",
    "untrusted_tool",
    "generate_video",
    "generate_audio",
  ]);

  assert.deepEqual(Object.keys(tools), [
    "generate_image",
    "generate_video",
    "generate_audio",
  ]);
  assert.equal("execute" in tools.generate_image, false);
  assert.equal("execute" in tools.generate_video, false);
  assert.equal("execute" in tools.generate_audio, false);
});

test("AI SDK media tools expose provider-compatible object schemas", async () => {
  const tools = buildAIChatTools([
    "generate_image",
    "generate_video",
    "generate_audio",
  ]);
  const unsupportedTopLevelKeywords = [
    "oneOf",
    "anyOf",
    "allOf",
    "enum",
    "const",
    "not",
  ];

  for (const name of [
    "generate_image",
    "generate_video",
    "generate_audio",
  ] as const) {
    const schema = await asSchema(tools[name].inputSchema).jsonSchema;
    assert.equal(schema.type, "object", `${name} must use an object schema`);
    for (const keyword of unsupportedTopLevelKeywords) {
      assert.equal(
        keyword in schema,
        false,
        `${name} must not use top-level ${keyword}`
      );
    }
  }

  const audioSchema = await asSchema(
    tools.generate_audio.inputSchema
  ).jsonSchema;
  const imageSchema = await asSchema(
    tools.generate_image.inputSchema
  ).jsonSchema;
  const promptHelpModel = imageSchema.properties?.prompt_help_model as
    | { enum?: unknown[]; description?: string }
    | undefined;
  assert.deepEqual(promptHelpModel?.enum, ["auto", "terra", "sol"]);
  assert.match(promptHelpModel?.description ?? "", /stronger Navy chat model/i);
  assert.deepEqual(audioSchema.required, ["input"]);
  assert.equal("input" in (audioSchema.properties ?? {}), true);
  assert.equal("text" in (audioSchema.properties ?? {}), false);
});

test("AI SDK media tools describe execution intent, not prompt-writing tasks", () => {
  const tools = buildAIChatTools([
    "generate_image",
    "generate_video",
    "generate_audio",
  ]);
  const imageDescription =
    typeof tools.generate_image.description === "string"
      ? tools.generate_image.description
      : "";
  const videoDescription =
    typeof tools.generate_video.description === "string"
      ? tools.generate_video.description
      : "";
  const audioDescription =
    typeof tools.generate_audio.description === "string"
      ? tools.generate_audio.description
      : "";

  assert.match(
    imageDescription,
    /only when the user wants an image created or edited now/i
  );
  assert.match(
    imageDescription,
    /not for writing or improving an image prompt/i
  );
  assert.match(
    videoDescription,
    /not when video is only source material or context/i
  );
  assert.match(
    audioDescription,
    /not when audio is only source material or context/i
  );
});

test("AI SDK stream state exposes every completed parallel tool call", () => {
  const state = extractAIChatStreamState({
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "reasoning", text: "The user requested two assets." },
      { type: "text", text: "Creating both assets." },
      {
        type: "dynamic-tool",
        toolCallId: "call_image",
        toolName: "generate_image",
        state: "input-available",
        input: { prompt: "a lighthouse" },
      },
      {
        type: "dynamic-tool",
        toolCallId: "call_audio",
        toolName: "generate_audio",
        state: "input-available",
        input: { input: "Welcome home" },
      },
    ],
  });

  assert.equal(state.content, "Creating both assets.");
  assert.equal(state.thinking, "The user requested two assets.");
  assert.deepEqual(state.toolCalls, [
    {
      id: "call_image",
      type: "function",
      function: {
        name: "generate_image",
        arguments: '{"prompt":"a lighthouse"}',
      },
    },
    {
      id: "call_audio",
      type: "function",
      function: {
        name: "generate_audio",
        arguments: '{"input":"Welcome home"}',
      },
    },
  ]);
});

test("AI SDK stream state exposes output-limit completion metadata", () => {
  const state = extractAIChatStreamState({
    id: "assistant-truncated",
    role: "assistant",
    metadata: { finishReason: "length" },
    parts: [{ type: "text", text: "Partial response" }],
  });

  assert.equal(state.finishReason, "length");
  assert.equal(state.outputTokenLimitReached, true);
});

test("AI SDK stream state exposes safe token usage metadata", () => {
  const state = extractAIChatStreamState({
    id: "assistant-usage",
    role: "assistant",
    metadata: {
      finishReason: "stop",
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 20,
        reasoningTokens: 10,
        ignored: 999,
      },
    },
    parts: [{ type: "text", text: "Done" }],
  });

  assert.deepEqual(state.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 20,
    reasoningTokens: 10,
  });
});

test("AI SDK stream state turns invalid tool input into a resolvable tool call", () => {
  const state = extractAIChatStreamState({
    id: "assistant-invalid-tool",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call_invalid_image",
        toolName: "generate_image",
        state: "output-error",
        input: { width: "huge" },
        errorText: "Invalid input: prompt is required.",
      },
    ],
  });

  assert.deepEqual(state.toolCalls, [
    {
      id: "call_invalid_image",
      type: "function",
      input_error: "Invalid input: prompt is required.",
      function: {
        name: "generate_image",
        arguments: '{"width":"huge"}',
      },
    },
  ]);
  assert.deepEqual(state.toolErrors, []);
});

test("AI SDK stream state recovers valid tool input exposed as a JSON string", () => {
  const state = extractAIChatStreamState({
    id: "assistant-luna-tool",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call_luna_image",
        toolName: "generate_image",
        state: "output-error",
        input: '{"prompt":"a moonlit harbor","width":1536}',
        errorText: "The model called a tool with invalid inputs.",
      },
    ],
  });

  assert.deepEqual(state.toolCalls, [
    {
      id: "call_luna_image",
      type: "function",
      function: {
        name: "generate_image",
        arguments: '{"prompt":"a moonlit harbor","width":1536}',
      },
    },
  ]);
});

test("AI SDK stream state keeps schema-invalid JSON strings blocked", () => {
  const state = extractAIChatStreamState({
    id: "assistant-invalid-encoded-tool",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call_invalid_encoded_image",
        toolName: "generate_image",
        state: "output-error",
        input: '{"prompt":"","width":"huge","unexpected":true}',
        errorText: "The model called a tool with invalid inputs.",
      },
    ],
  });

  assert.equal(
    state.toolCalls[0]?.input_error,
    "The model called a tool with invalid inputs.",
  );
  assert.equal(
    state.toolCalls[0]?.function.arguments,
    '"{\\"prompt\\":\\"\\",\\"width\\":\\"huge\\",\\"unexpected\\":true}"',
  );
});

test("AI SDK chat round-trips Gemini thought signatures through client history", () => {
  const state = extractAIChatStreamState({
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call_image",
        toolName: "generate_image",
        state: "input-available",
        input: { prompt: "a lighthouse" },
        callProviderMetadata: {
          navy: { thoughtSignature: "opaque-signature==" },
        },
      },
    ],
  });

  assert.deepEqual(state.toolCalls[0]?.extra_content, {
    google: { thought_signature: "opaque-signature==" },
  });

  const messages = toAIModelMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: state.toolCalls,
    },
  ]);
  assert.equal(messages[0]?.role, "assistant");
  const content = messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    Array.isArray(content) && content[0]?.type === "tool-call"
      ? content[0].providerOptions
      : undefined,
    { google: { thoughtSignature: "opaque-signature==" } }
  );
});

test("AI SDK stream state recognizes NanoGPT Gemini thought signatures", () => {
  const state = extractAIChatStreamState({
    id: "assistant-nanogpt",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call_nano_signed",
        toolName: "generate_image",
        state: "input-available",
        input: { prompt: "a glass lighthouse" },
        callProviderMetadata: {
          nanogpt: { thoughtSignature: "nano-signature==" },
        },
      },
    ],
  });

  assert.deepEqual(state.toolCalls[0]?.extra_content, {
    google: { thought_signature: "nano-signature==" },
  });
});

test("AI SDK JSON schemas validate tool inputs at runtime", async () => {
  const tools = buildAIChatTools(["generate_image"]);
  const schema = asSchema(tools.generate_image.inputSchema);
  assert.ok(schema.validate);

  const valid = await schema.validate({
    prompt: "a moonlit harbor",
    width: 1024,
  });
  assert.equal(valid.success, true);

  const invalid = await schema.validate({
    prompt: "",
    width: 8,
    unexpected: true,
  });
  assert.equal(invalid.success, false);
});

test("Chat tools are disabled only when model metadata explicitly rejects them", () => {
  assert.equal(chatModelToolSupport(undefined), null);
  assert.equal(chatModelToolSupport({}), null);
  assert.equal(chatModelToolSupport({ supportsTools: true }), true);
  assert.equal(chatModelToolSupport({ supportsFunctionCalling: true }), true);
  assert.equal(chatModelToolSupport({ supportsTools: false }), false);
  assert.equal(
    chatModelToolSupport({
      supportsTools: false,
      supportsFunctionCalling: true,
    }),
    true
  );
});
