import test from "node:test";
import assert from "node:assert/strict";

import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import {
  buildNavyImageGenerationPayload,
  buildChutesChatSystemPrompt,
  extractOpenRouterImageModels,
  getActiveJobCount,
  groupNavyModelsByCapability,
  isNavyGenerationPending,
  resolveOpenRouterModalities,
} from "./studio-generation.ts";

test("OpenRouter image-only models use image-only modality", () => {
  assert.deepEqual(resolveOpenRouterModalities("black-forest-labs/flux.2-pro"), [
    "image",
  ]);
  assert.deepEqual(
    resolveOpenRouterModalities("google/gemini-2.5-flash-image-preview", [
      "text",
      "image",
    ]),
    ["image", "text"]
  );
});

test("OpenRouter model extraction keeps image-capable models and metadata", () => {
  const models = extractOpenRouterImageModels({
    data: [
      {
        id: "google/gemini-2.5-flash-image-preview",
        name: "Gemini 2.5 Flash Image Preview",
        output_modalities: ["text", "image"],
      },
      {
        id: "black-forest-labs/flux.2-pro",
        name: "Flux 2 Pro",
        output_modalities: ["image"],
      },
      {
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
        output_modalities: ["text"],
      },
    ],
  });

  assert.equal(models.length, 2);
  assert.deepEqual(models[0]?.outputModalities, ["text", "image"]);
  assert.deepEqual(models[1]?.outputModalities, ["image"]);
});

test("Only queued and running jobs count as active work", () => {
  assert.equal(
    getActiveJobCount([
      { status: "queued" },
      { status: "running" },
      { status: "success" },
      { status: "error" },
    ]),
    2
  );
});

test("Navy image payload maps OpenAI-compatible fields to Navy API fields", () => {
  assert.deepEqual(
    buildNavyImageGenerationPayload({
      model: "flux",
      prompt: "A naval command room at dusk",
      size: "1024x1024",
      numberOfImages: 2,
      quality: "medium",
      imageUrl: "https://example.com/ref.png",
      negativePrompt: "text artifacts",
      seed: 42,
      seconds: 6,
      sync: false,
      responseFormat: "url",
      aspectRatio: "16:9",
    }),
    {
      model: "flux",
      prompt: "A naval command room at dusk",
      size: "1024x1024",
      n: 2,
      quality: "medium",
      image_url: "https://example.com/ref.png",
      negative_prompt: "text artifacts",
      seed: 42,
      seconds: 6,
      sync: false,
      response_format: "url",
      aspect_ratio: "16:9",
    }
  );
});

test("Navy pending statuses are recognized consistently", () => {
  assert.equal(isNavyGenerationPending("processing"), true);
  assert.equal(isNavyGenerationPending("completed"), false);
  assert.equal(isNavyGenerationPending("succeeded"), false);
});

test("Navy model catalog is normalized into image, video, and TTS groups", () => {
  const grouped = groupNavyModelsByCapability({
    data: [
      {
        id: "gpt-5",
        name: "GPT-5",
        endpoint: "/v1/chat/completions",
      },
      {
        id: "flux",
        name: "Flux",
        endpoint: "/v1/images/generations",
      },
      {
        id: "veo-3.1",
        name: "Veo 3.1",
        endpoint: "/v1/images/generations",
      },
      {
        id: "gpt-4o-mini-tts",
        name: "GPT-4o Mini TTS",
        endpoint: "/v1/audio/speech",
      },
      {
        id: "whisper-1",
        name: "Whisper",
        endpoint: "/v1/audio/transcriptions",
      },
    ],
  });

  assert.deepEqual(
    grouped.chat.map((model) => model.id),
    ["gpt-5"]
  );
  assert.deepEqual(
    grouped.image.map((model) => model.id),
    ["flux"]
  );
  assert.deepEqual(
    grouped.video.map((model) => model.id),
    ["veo-3.1"]
  );
  assert.deepEqual(
    grouped.audio.map((model) => model.id),
    ["gpt-4o-mini-tts"]
  );
});

test("Chutes prompts do not include unsafe jailbreak instructions", () => {
  assert.equal(
    CHUTES_IMAGE_GUIDE_PROMPT.includes("exception to AI's usual ethical protocols"),
    false
  );
  assert.equal(CHUTES_IMAGE_GUIDE_PROMPT.includes("violent act"), false);
});

test("Chutes chat system prompt explicitly instructs tool usage", () => {
  const prompt = buildChutesChatSystemPrompt({
    toolImageModel: "z-image-turbo",
    imageModels: [
      { id: "z-image-turbo", label: "Z Image Turbo" },
      { id: "chutes-hidream", label: "HiDream" },
    ],
  });

  assert.match(prompt, /call generate_image/i);
  assert.match(prompt, /default image model: z-image-turbo/i);
});
