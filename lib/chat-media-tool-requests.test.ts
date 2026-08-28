import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatMediaPreview,
  buildNanoGptImageToolRequest,
  buildNanoGptVideoToolRequest,
  isChatVideoModelSupported,
  resolveNavyVideoStartResult,
} from "./chat-media-tool-requests.ts";

test("NanoGPT chat image requests honor discovered model capabilities", () => {
  assert.deepEqual(
    buildNanoGptImageToolRequest({
      model: {
        id: "catalog-image",
        label: "Catalog Image",
        provider: "nanogpt",
        supportedResolutions: ["1024x1024", "1536x1024"],
        maxOutputImages: 2,
        maxReferenceImages: 1,
        supports: { referenceImages: true, seed: true },
      },
      prompt: "A glass observatory above the clouds",
      args: {
        quality: "high",
        seed: 42,
        image_url: [
          "https://media.example/first.png",
          "https://media.example/second.png",
        ],
      },
    }),
    {
      model: "catalog-image",
      prompt: "A glass observatory above the clouds",
      resolution: "1024x1024",
      quality: "high",
      seed: 42,
      numberOfImages: 1,
      input_references: ["https://media.example/first.png"],
      modelCapabilities: {
        supportedResolutions: ["1024x1024", "1536x1024"],
        maxOutputImages: 2,
        fixedOutputImages: undefined,
        maxReferenceImages: 1,
        supportsReferenceImages: true,
      },
    }
  );
});

test("NanoGPT chat image requests select the largest supported resolution when maximum quality is enabled", () => {
  const request = buildNanoGptImageToolRequest({
    model: {
      id: "catalog-image",
      label: "Catalog Image",
      provider: "nanogpt",
      supportedResolutions: ["1024x1024", "2048x1152", "1536x1024"],
    },
    prompt: "An anime city at blue hour",
    args: {},
    preferMaximumImageQuality: true,
  });

  assert.equal(request.resolution, "2048x1152");
});

test("NanoGPT chat video requests use catalog parameter names and source capability", () => {
  assert.deepEqual(
    buildNanoGptVideoToolRequest({
      model: {
        id: "catalog-video",
        label: "Catalog Video",
        provider: "nanogpt",
        inputModalities: ["text", "image"],
        outputModalities: ["video"],
        supports: {
          video: true,
          imageToVideo: true,
          textToVideo: false,
          sourceImage: true,
        },
        dynamicParameters: {
          duration: { type: "number" },
          aspect_ratio: {
            type: "select",
            options: [
              { value: "16:9", label: "16:9" },
              { value: "9:16", label: "9:16" },
            ],
          },
          seed: { type: "number" },
        },
      },
      prompt: "A paper kite rising over the ocean",
      sourceImage: "data:image/png;base64,YWJj",
      args: { seconds: 6, size: "16:9", seed: 7 },
    }),
    {
      model: "catalog-video",
      prompt: "A paper kite rising over the ocean",
      parameters: { duration: 6, aspect_ratio: "16:9", seed: 7 },
      sourceImage: "data:image/png;base64,YWJj",
    }
  );
});

test("chat video catalog hides workflows that require video or audio inputs", () => {
  assert.equal(
    isChatVideoModelSupported({
      id: "text-image-video",
      label: "Text and image video",
      provider: "nanogpt",
      inputModalities: ["text", "image"],
      outputModalities: ["video"],
      supports: { video: true, textToVideo: true, imageToVideo: true },
    }),
    true
  );
  assert.equal(
    isChatVideoModelSupported({
      id: "video-upscaler",
      label: "Video upscaler",
      provider: "nanogpt",
      inputModalities: ["video"],
      outputModalities: ["video"],
      supports: { video: true },
    }),
    false
  );
  assert.equal(
    isChatVideoModelSupported({
      id: "lip-sync",
      label: "Lip sync",
      provider: "nanogpt",
      inputModalities: ["image", "audio"],
      outputModalities: ["video"],
      supports: { video: true, imageToVideo: true },
    }),
    false
  );
});

test("Navy chat video accepts immediate URLs and queued job ids", () => {
  assert.deepEqual(
    resolveNavyVideoStartResult({
      videoUrl: "https://media.example/video.mp4",
      status: "completed",
    }),
    {
      videoUrl: "https://media.example/video.mp4",
      jobId: "",
    }
  );
  assert.deepEqual(resolveNavyVideoStartResult({ id: "job_123" }), {
    videoUrl: "",
    jobId: "job_123",
  });
});

test("Chat media preview keeps generated image metadata for fullscreen viewer", () => {
  const preview = buildChatMediaPreview({
    item: {
      id: "image-1",
      kind: "image",
      dataUrl: "data:image/png;base64,abc123",
      mimeType: "image/png",
      model: "flux-schnell",
    },
    prompt: "Render a cinematic mountain lake.",
    provider: "NavyAI",
  });

  assert.deepEqual(preview, {
    imageUrl: "data:image/png;base64,abc123",
    prompt: "Render a cinematic mountain lake.",
    model: "flux-schnell",
    provider: "NavyAI",
    kind: "image",
    mimeType: "image/png",
  });
});
