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
