import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatCompletionPayload,
  createSyntheticFallbackToolCall,
  detectForcedToolCall,
  repairImageToolArguments,
  resolveRequestedImageModels,
  sanitizeChatImageAssets,
  sanitizeChatMediaAssets,
  shouldOmitToolChoiceForModel,
  stripHeavyMediaFromMessagesForStorage,
  toChatCompletionMessages,
} from "./chat-tooling.ts";

test("Forced tool detection recognizes explicit audio requests", () => {
  assert.equal(
    detectForcedToolCall("Turn this paragraph into speech and generate audio now.", {
      image: true,
      video: true,
      audio: true,
    }),
    "generate_audio"
  );
});

test("Forced tool detection recognizes explicit video requests", () => {
  assert.equal(
    detectForcedToolCall("Animate this image into a short video clip now.", {
      image: true,
      video: true,
      audio: true,
    }),
    "generate_video"
  );
});

test("Synthetic fallback builds an image tool call from the drafted prompt without pinning the default model", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_image",
    provider: "navy",
    userPrompt: "Generate an anime portrait now.",
    assistantContent:
      "Final Flux prompt: sharp modern anime portrait, blue rim light, clean silhouette.\nNegative prompt: watermark",
    imageModel: "flux",
    imagePipelineEnabled: true,
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
  });

  assert.deepEqual(fallback, {
    name: "generate_image",
    arguments: {
      prompt: "sharp modern anime portrait, blue rim light, clean silhouette.",
    },
  });
});

test("Image tool argument repair replaces negative-only prompt with assistant draft", () => {
  const assistantContent = `Let me craft this prompt carefully, preserving all the specific details the user provided.

A high-detail modern anime illustration of three figures in a tense triangular confrontation inside a slightly run-down shopping mall corridor during late afternoon. Center: a tall imposing young man with a lean densely muscular build and pale skin, wearing an intricate dark metal mask covering his entire face with etched sacred geometry and faintly glowing cyan circuitry patterns.

Optional negative prompt: blurry characters, extra limbs, deformed hands, watermark, text, logo, low detail, flat shading

Video readiness note: Stable triangular composition with clear character separation.`;

  const repaired = repairImageToolArguments(
    {
      prompt:
        "blurry characters, extra limbs, deformed hands, watermark, text, logo, low detail, flat shading",
    },
    {
      assistantContent,
      userPrompt: "Generate the mall confrontation image now.",
    }
  );

  assert.match(String(repaired.prompt), /high-detail modern anime illustration/i);
  assert.match(String(repaired.prompt), /shopping mall corridor/i);
  assert.equal(
    repaired.negative_prompt,
    "blurry characters, extra limbs, deformed hands, watermark, text, logo, low detail, flat shading"
  );
});

test("Image tool argument repair leaves valid image prompts intact", () => {
  const repaired = repairImageToolArguments(
    {
      prompt: "High-detail anime portrait in a neon arcade, cinematic rim light.",
      negative_prompt: "watermark, bad hands",
    },
    {
      assistantContent: "Optional negative prompt: watermark, bad hands",
      userPrompt: "Generate the image now.",
    }
  );

  assert.equal(
    repaired.prompt,
    "High-detail anime portrait in a neon arcade, cinematic rim light."
  );
  assert.equal(repaired.negative_prompt, "watermark, bad hands");
});

test("DeepSeek-family chat payloads omit explicit tool_choice while keeping tools", () => {
  assert.equal(shouldOmitToolChoiceForModel("deepseek-v4-pro"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-reasoner"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-ai/DeepSeek-V3"), true);

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
  assert.equal(payload.temperature, 0.7);
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

test("Chat messages omit UI-only thinking unless reasoning passthrough is enabled", () => {
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

test("Requested image models use the pipeline when the request targets the default model", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "flux",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Requested image models stay pinned when a non-default model is explicitly requested", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "gpt-image-1.5",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["flux", "gpt-image-1.5"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5"]
  );
});

test("Chat image assets preserve per-image model labels", () => {
  assert.deepEqual(
    sanitizeChatImageAssets([
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "gpt-image-1.5",
      },
    ]),
    [
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "gpt-image-1.5",
      },
    ]
  );
});

test("Chat media assets preserve per-image model labels", () => {
  assert.deepEqual(
    sanitizeChatMediaAssets([
      {
        id: "img-1",
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "flux",
      },
    ]),
    [
      {
        id: "img-1",
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "flux",
      },
    ]
  );
});

test("Synthetic fallback builds a Navy video tool call with current defaults", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_video",
    provider: "navy",
    userPrompt: "Generate a short video now.",
    assistantContent: "",
    imageModel: "flux",
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
    videoAspect: "16:9",
    videoDuration: "8",
    videoImage: "data:image/png;base64,abc123",
  });

  assert.deepEqual(fallback, {
    name: "generate_video",
    arguments: {
      prompt: "Generate a short video now.",
      model: "veo-3.1",
      size: "16:9",
      seconds: 8,
      image_url: "data:image/png;base64,abc123",
    },
  });
});

test("Synthetic fallback refuses Chutes video generation without a source image", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_video",
    provider: "chutes",
    userPrompt: "Animate this now.",
    assistantContent: "",
    imageModel: "flux",
    videoModel: "ltx-video",
    audioModel: "kokoro",
  });

  assert.equal(fallback, null);
});

test("Synthetic fallback builds an audio tool call with current TTS defaults", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_audio",
    provider: "navy",
    userPrompt: "Read this welcome message aloud now.",
    assistantContent: "Final script: Welcome to the studio.",
    imageModel: "flux",
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
    ttsVoice: "alloy",
    ttsFormat: "mp3",
    ttsSpeed: "1.1",
  });

  assert.deepEqual(fallback, {
    name: "generate_audio",
    arguments: {
      input: "Welcome to the studio.",
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      response_format: "mp3",
      speed: 1.1,
    },
  });
});

test("Persisted chat history drops heavy media payloads and keeps newest entries", () => {
  const stored = stripHeavyMediaFromMessagesForStorage(
    [
      {
        id: "old",
        role: "assistant",
        content: "Old",
        media: [{ id: "m-old", kind: "image", dataUrl: "data:image/png;base64,old" }],
      },
      {
        id: "new",
        role: "tool",
        content: "Generated image.",
        images: [{ id: "img-1", dataUrl: "data:image/png;base64,new" }],
      },
    ],
    1
  );

  assert.deepEqual(stored, [
    {
      id: "new",
      role: "tool",
      content: "Generated image.",
    },
  ]);
});
