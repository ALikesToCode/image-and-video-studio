import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatCompletionPayload,
  buildChatCompletionRecoveryPayloads,
  isDeepSeekV4Model,
  normalizeDeepSeekReasoningEffort,
  normalizeReasoningEffort,
  shouldOmitToolChoiceForModel,
  stripReasoningContentFromChatPayload,
  toChatCompletionMessages,
} from "./chat-completion.ts";
import { sanitizeChatAttachmentAssets } from "./chat-media-persistence.ts";

test("DeepSeek-family chat payloads omit explicit tool_choice while keeping tools", () => {
  assert.equal(shouldOmitToolChoiceForModel("deepseek-v4-pro"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-v4-flash"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-reasoner"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-ai/DeepSeek-V3"), true);
  assert.equal(isDeepSeekV4Model("deepseek-v4-pro"), true);
  assert.equal(isDeepSeekV4Model("deepseek-v4-flash"), true);

  const payload = buildChatCompletionPayload({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "Generate an image now." }],
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
    maxTokens: 256,
    temperature: 0.7,
    omitToolChoiceForUnsupportedModels: true,
  });

  assert.equal("tool_choice" in payload, false);
  assert.equal(payload.tools instanceof Array, true);
  assert.equal(payload.max_tokens, 256);
  assert.deepEqual(payload.thinking, { type: "enabled" });
  assert.equal(payload.reasoning_effort, "high");
  assert.equal("temperature" in payload, false);
});

test("DeepSeek V4 payloads can disable thinking and keep sampling controls", () => {
  const payload = buildChatCompletionPayload({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "Reply briefly." }],
    maxTokens: 64,
    temperature: 0.7,
    thinking: { type: "disabled" },
    reasoningEffort: "max",
  });

  assert.deepEqual(payload.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in payload, false);
  assert.equal(payload.temperature, 0.7);
});

test("DeepSeek V4 payloads support max reasoning effort aliases", () => {
  assert.equal(normalizeDeepSeekReasoningEffort("high"), "high");
  assert.equal(normalizeDeepSeekReasoningEffort("low"), "high");
  assert.equal(normalizeDeepSeekReasoningEffort("medium"), "high");
  assert.equal(normalizeDeepSeekReasoningEffort("max"), "max");
  assert.equal(normalizeDeepSeekReasoningEffort("xhigh"), "max");

  const payload = buildChatCompletionPayload({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "Think carefully." }],
    reasoningEffort: "max",
  });

  assert.deepEqual(payload.thinking, { type: "enabled" });
  assert.equal(payload.reasoning_effort, "max");
});

test("General Navy reasoning payloads use the model default temperature", () => {
  assert.equal(normalizeReasoningEffort("none"), "none");
  assert.equal(normalizeReasoningEffort("minimal"), "minimal");
  assert.equal(normalizeReasoningEffort("low"), "low");
  assert.equal(normalizeReasoningEffort("medium"), "medium");
  assert.equal(normalizeReasoningEffort("high"), "high");
  assert.equal(normalizeReasoningEffort("xhigh"), "xhigh");
  assert.equal(normalizeReasoningEffort("max"), "xhigh");
  assert.equal(normalizeReasoningEffort("invalid"), "high");

  const payload = buildChatCompletionPayload({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "Think carefully." }],
    reasoningEffort: "xhigh",
    temperature: 0.7,
  });

  assert.equal("thinking" in payload, false);
  assert.equal(payload.reasoning_effort, "xhigh");
  assert.equal("temperature" in payload, false);
});

test("OpenAI reasoning model payloads use the default temperature without metadata", () => {
  const payload = buildChatCompletionPayload({
    model: "openai/gpt-5-mini",
    messages: [{ role: "user", content: "Reply briefly." }],
    temperature: 0.7,
  });

  assert.equal("temperature" in payload, false);
});

test("Chat recovery can drop unsupported reasoning controls", () => {
  const payload = buildChatCompletionPayload({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "Think carefully." }],
    reasoningEffort: "xhigh",
    temperature: 0.7,
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload);
  assert.equal(recoveries[0]?.label, "omit-reasoning-controls");
  assert.equal("reasoning_effort" in recoveries[0].payload, false);
  assert.equal("temperature" in recoveries[0].payload, false);
});

test("Chat recovery explicitly disables reasoning when tools require it", () => {
  const payload = buildChatCompletionPayload({
    model: "future-tool-reasoner",
    messages: [{ role: "user", content: "Generate an image." }],
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
    reasoningEffort: "high",
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: {
      error: {
        message:
          "Function tools with reasoning_effort are not supported for future-tool-reasoner in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
      },
    },
  });

  assert.equal(recoveries[0]?.label, "disable-reasoning-for-tools");
  assert.equal(recoveries[0]?.payload.reasoning_effort, "none");
  assert.equal("tools" in recoveries[0].payload, true);
  assert.equal(recoveries[0].payload.tool_choice, "auto");
  assert.equal(payload.reasoning_effort, "high");
});

test("Chat tool recovery disables active reasoning and strips historical reasoning", () => {
  const payload = buildChatCompletionPayload({
    model: "future-tool-reasoner",
    messages: [
      { role: "user", content: "Generate an image." },
      {
        role: "assistant",
        content: "",
        reasoning_content: "I should call the image tool.",
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
    reasoningEffort: "high",
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: {
      error: {
        message:
          "reasoning_effort must be none when function tools are present.",
      },
    },
  });
  const retryMessages = recoveries[0]?.payload.messages as Array<
    Record<string, unknown>
  >;

  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0]?.label, "disable-reasoning-for-tools");
  assert.equal(recoveries[0]?.payload.reasoning_effort, "none");
  assert.equal("reasoning_content" in retryMessages[1], false);
});

test("Chat recovery does not disable reasoning for unrelated provider errors", () => {
  const payload = buildChatCompletionPayload({
    model: "future-tool-reasoner",
    messages: [{ role: "user", content: "Generate an image." }],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    reasoningEffort: "high",
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: { error: { message: "Unsupported tool schema." } },
  });

  assert.equal(
    recoveries.some(
      (recovery) => recovery.label === "disable-reasoning-for-tools"
    ),
    false
  );
});

test("Non-DeepSeek chat payloads preserve explicit tool_choice", () => {
  const payload = buildChatCompletionPayload({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Generate an image now." }],
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
    omitToolChoiceForUnsupportedModels: true,
  });

  assert.equal(payload.tool_choice, "auto");
  assert.equal("thinking" in payload, false);
  assert.equal("reasoning_effort" in payload, false);
});

test("Chat payloads omit tool_choice when no tools are present", () => {
  const payload = buildChatCompletionPayload({
    model: "glm-5.1-venice",
    messages: [{ role: "user", content: "Reply briefly." }],
    toolChoice: "none",
    omitToolChoiceForUnsupportedModels: true,
  });

  assert.equal("tools" in payload, false);
  assert.equal("tool_choice" in payload, false);
});

test("Chat recovery payloads strip reasoning before dropping tools", () => {
  const payload = {
    model: "glm-5.1-venice",
    stream: true,
    messages: [
      { role: "user", content: "Generate an image." },
      {
        role: "assistant",
        content: "",
        reasoning_content: "Need to call the image tool.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "generate_image", arguments: "{\"prompt\":\"sky\"}" },
          },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: { name: "generate_image", parameters: { type: "object" } },
      },
    ],
    tool_choice: "auto",
  };

  const stripped = stripReasoningContentFromChatPayload(payload);
  assert.ok(stripped);
  assert.equal(
    "reasoning_content" in
      ((stripped?.messages as Array<Record<string, unknown>>)[1] ?? {}),
    false
  );
  assert.equal("tools" in (stripped ?? {}), true);

  const recoveries = buildChatCompletionRecoveryPayloads(payload);
  assert.deepEqual(
    recoveries.map((recovery) => recovery.label),
    ["strip-reasoning", "omit-tool-choice", "text-only"]
  );
  assert.equal("tools" in recoveries[0].payload, true);
  assert.equal("tool_choice" in recoveries[1].payload, false);
  assert.equal("tools" in recoveries[2].payload, false);
});

test("Chat recovery payloads can omit unsupported sampling fields", () => {
  const payload = buildChatCompletionPayload({
    model: "custom-chat-model",
    messages: [{ role: "user", content: "Rewrite this prompt." }],
    maxTokens: 700,
    temperature: 0.2,
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload);
  const omitSampling = recoveries.find(
    (recovery) => recovery.label === "omit-sampling"
  );

  assert.ok(omitSampling);
  assert.equal("temperature" in omitSampling.payload, false);
  assert.equal(omitSampling.payload.max_tokens, 700);
});

test("Chat recovery lowers rejected large output budgets without dropping tools", () => {
  const payload = buildChatCompletionPayload({
    model: "aihubmix:gpt-5.5-free",
    messages: [{ role: "user", content: "Generate an image." }],
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
    maxTokens: 16_384,
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: { error: { message: "Bad Request" } },
  });

  assert.equal(recoveries[0]?.label, "limit-output-tokens");
  assert.equal(recoveries[0]?.payload.max_tokens, 8_192);
  assert.equal("tools" in recoveries[0].payload, true);
  assert.equal(recoveries[0].payload.tool_choice, "auto");
});

test("Navy chat messages pass assistant reasoning content back for thinking-mode tool turns", () => {
  const messages = toChatCompletionMessages(
    [
      {
        role: "assistant",
        content: "",
        thinking: "Need to call the image tool.",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "generate_image", arguments: "{\"prompt\":\"sky\"}" },
          },
        ],
      },
      {
        role: "tool",
        content: "Image generated.",
        toolCallId: "call_1",
        name: "generate_image",
      },
    ],
    { includeReasoningContent: true }
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: "",
      reasoning_content: "Need to call the image tool.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "generate_image", arguments: "{\"prompt\":\"sky\"}" },
        },
      ],
    },
    {
      role: "tool",
      content: "Image generated.",
      tool_call_id: "call_1",
      name: "generate_image",
    },
  ]);
});

test("Chat completion messages drop local tool progress placeholders", () => {
  const messages = toChatCompletionMessages(
    [
      {
        role: "assistant",
        content: "",
        thinking: "Need image generation.",
        toolCalls: [
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
      {
        role: "tool",
        content: "Invoking generate_image...",
        toolCallId: "call_1",
        name: "generate_image",
      },
      {
        role: "tool",
        content: "Generated 1 image(s) using flux.",
        toolCallId: "call_1",
        name: "generate_image",
      },
    ],
    { includeReasoningContent: true }
  );

  assert.deepEqual(messages, [
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
    {
      role: "tool",
      content: "Generated 1 image(s) using flux.",
      tool_call_id: "call_1",
      name: "generate_image",
    },
  ]);
});

test("Chat completion messages drop orphaned tool responses from older synthetic fallback runs", () => {
  const messages = toChatCompletionMessages(
    [
      {
        role: "assistant",
        content: "I drafted the image prompt.",
      },
      {
        role: "tool",
        content: "Generated 1 image(s) using flux.",
        toolCallId: "synthetic-call-1",
        name: "generate_image",
      },
      {
        role: "user",
        content: "Continue.",
      },
    ],
    { includeReasoningContent: true }
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: "I drafted the image prompt.",
    },
    {
      role: "user",
      content: "Continue.",
    },
  ]);
});

test("Navy chat messages pass assistant reasoning content back without a tool call", () => {
  assert.deepEqual(
    toChatCompletionMessages(
      [
        {
          role: "assistant",
          content: "Done.",
          thinking: "Hidden provider reasoning.",
        },
      ],
      { includeReasoningContent: true }
    ),
    [
      {
        role: "assistant",
        content: "Done.",
        reasoning_content: "Hidden provider reasoning.",
      },
    ]
  );
});

test("User chat attachments become OpenAI-compatible multimodal content parts", () => {
  const messages = toChatCompletionMessages([
    {
      role: "user",
      content: "Describe these inputs.",
      attachments: [
        {
          id: "att-image",
          kind: "image",
          name: "scene.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,abc",
        },
        {
          id: "att-pdf",
          kind: "pdf",
          name: "brief.pdf",
          mimeType: "application/pdf",
          text: "Extracted PDF text",
          pagesRead: 2,
          totalPages: 3,
          truncated: true,
        },
      ],
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe these inputs." },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc" },
        },
        {
          type: "text",
          text: 'Attached pdf "brief.pdf" (PDF, application/pdf, 2/3 pages, truncated)\n\nExtracted PDF text',
        },
      ],
    },
  ]);
});

test("Sanitized chat attachments reject missing payloads and preserve usable files", () => {
  assert.deepEqual(
    sanitizeChatAttachmentAssets([
      {
        id: "img-1",
        kind: "image",
        name: "image.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc",
        size: 42,
      },
      {
        id: "bad-img",
        kind: "image",
        name: "missing-data.png",
        mimeType: "image/png",
      },
      {
        id: "text-1",
        kind: "text",
        name: "notes.md",
        mimeType: "text/markdown",
        text: "Notes",
      },
    ]),
    [
      {
        id: "img-1",
        kind: "image",
        name: "image.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc",
        size: 42,
      },
      {
        id: "text-1",
        kind: "text",
        name: "notes.md",
        mimeType: "text/markdown",
        text: "Notes",
      },
    ]
  );
});

test("Chat messages omit assistant thinking unless reasoning content is requested", () => {
  assert.deepEqual(
    toChatCompletionMessages([
      {
        role: "assistant",
        content: "Done.",
        thinking: "Hidden provider reasoning.",
      },
    ]),
    [
      {
        role: "assistant",
        content: "Done.",
      },
    ]
  );
});
