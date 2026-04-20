import test from "node:test";
import assert from "node:assert/strict";

import {
  createSyntheticFallbackToolCall,
  detectForcedToolCall,
  resolveRequestedImageModels,
  stripHeavyMediaFromMessagesForStorage,
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
