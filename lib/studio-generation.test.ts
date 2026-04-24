import test from "node:test";
import assert from "node:assert/strict";

import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import {
  buildProviderPolicyHintForImageModels,
  buildNavyImageGenerationPayload,
  buildChutesChatSystemPrompt,
  extractOpenRouterImageModels,
  getActiveJobCount,
  getQueuedJobsToStart,
  mergeGeneratedImagesInDisplayOrder,
  prepareImageModelRequests,
  prepareImagePromptForModel,
  resolveImageGenerationModelPipeline,
  resolveImageSizingOptions,
  resolveActiveImageToolModels,
  groupNavyModelsByCapability,
  isNavyGenerationPending,
  resolveOpenRouterModalities,
  summarizeImageModelPrompts,
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
  const payload = buildNavyImageGenerationPayload({
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
  });

  assert.equal(payload.model, "flux");
  assert.equal(payload.n, 2);
  assert.equal(payload.quality, "medium");
  assert.equal(payload.image_url, "https://example.com/ref.png");
  assert.equal(payload.seed, 42);
  assert.equal(payload.seconds, 6);
  assert.equal(payload.sync, false);
  assert.equal(payload.response_format, "url");
  assert.equal(payload.aspect_ratio, "16:9");
  assert.equal("size" in payload, false);
  assert.equal("negative_prompt" in payload, false);
  assert.match(payload.prompt, /^A naval command room at dusk\./);
  assert.match(payload.prompt, /artifact-free rendering/i);
  assert.match(payload.prompt, /clean surfaces without embedded typography or branding/i);
});

test("Flux prompt preparation rewrites structured prompts into positive natural language", () => {
  const prepared = prepareImagePromptForModel(
    "flux",
    `Create a high-detail modern anime illustration.

Background/setting: Narrow urban alley in Ginza, Tokyo during late autumn afternoon.
Main character (focus): Satoru Gojo, very tall woman in late twenties.
Lighting: Dramatic contrast between warm golden hour sunlight and cold blue glow from blindfold.`,
    "blurry, text, watermark, extra fingers"
  );

  assert.equal(prepared.negativePrompt, undefined);
  assert.match(prepared.prompt, /Artwork direction: a high-detail modern anime illustration/i);
  assert.match(prepared.prompt, /Background and setting: Narrow urban alley in Ginza, Tokyo during late autumn afternoon\./i);
  assert.match(prepared.prompt, /Main character: Satoru Gojo, very tall woman in late twenties\./i);
  assert.match(prepared.prompt, /sharp focus and crisp detail/i);
  assert.match(prepared.prompt, /coherent anatomy with natural hands and accurate proportions/i);
});

test("Flux prompt preparation is idempotent for already prepared chat prompts", () => {
  const firstPass = prepareImagePromptForModel(
    "flux",
    `Create a high-detail modern anime illustration.

Background/setting: A worn shopping mall corridor in late afternoon.
Main character (focus): Three figures in tense confrontation.
Composition/camera: Medium-wide shot from a slightly low angle.`,
    "text, bad hands"
  );

  const secondPass = prepareImagePromptForModel(
    "flux",
    firstPass.prompt,
    "text, bad hands"
  );

  assert.equal(secondPass.prompt, firstPass.prompt);
  assert.equal(secondPass.negativePrompt, undefined);
  assert.equal(secondPass.prompt.match(/Desired qualities:/g)?.length, 1);
});

test("Chat image tool requests prepare Flux prompts before fetch", () => {
  const requests = prepareImageModelRequests({
    models: ["flux", "gpt-image-1.5"],
    baseBody: {
      apiKey: "test-key",
      size: "1024x1024",
    },
    prompt: `Create a high-detail modern anime illustration.

Background/setting: A slightly run-down shopping mall corridor in late afternoon.
Main character (focus): Three figures in tense confrontation.`,
    negativePrompt: "watermark, bad hands",
  });

  assert.equal(requests[0]?.body.model, "flux");
  assert.match(String(requests[0]?.body.prompt), /Artwork direction:/i);
  assert.match(String(requests[0]?.body.prompt), /Background and setting:/i);
  assert.match(String(requests[0]?.body.prompt), /clean surfaces without embedded typography or branding/i);
  assert.equal("negativePrompt" in (requests[0]?.body ?? {}), false);

  assert.equal(requests[1]?.body.model, "gpt-image-1.5");
  assert.match(String(requests[1]?.body.prompt), /Create a high-detail modern anime illustration/i);
  assert.equal(requests[1]?.body.negativePrompt, "watermark, bad hands");

  const promptSummary = summarizeImageModelPrompts(requests);
  assert.match(promptSummary, /^flux:\n/);
  assert.match(promptSummary, /\n\ngpt-image-1\.5:\n/);
});

test("Image model pipeline keeps explicit order and removes duplicates", () => {
  assert.deepEqual(
    resolveImageGenerationModelPipeline(
      ["black-forest-labs/flux.2-pro", "flux", "black-forest-labs/flux.2-pro"],
      "gpt-image-1.5",
      ["flux", "gpt-image-1.5", "black-forest-labs/flux.2-pro"]
    ),
    ["black-forest-labs/flux.2-pro", "flux"]
  );

  assert.deepEqual(
    resolveImageGenerationModelPipeline([], "flux", ["flux", "gpt-image-1.5"]),
    ["flux"]
  );
});

test("Active chat image tool models fall back to the selected model when pipeline is disabled", () => {
  assert.deepEqual(
    resolveActiveImageToolModels({
      pipelineEnabled: false,
      preferredModels: ["gpt-image-1.5", "flux"],
      fallbackModel: "flux",
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["flux"]
  );
});

test("Active chat image tool models honor the shared pipeline order when enabled", () => {
  assert.deepEqual(
    resolveActiveImageToolModels({
      pipelineEnabled: true,
      preferredModels: ["gpt-image-1.5", "flux", "gpt-image-1.5"],
      fallbackModel: "flux",
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("OpenAI image prompts add adult-content policy guidance only for likely NSFW requests", () => {
  const prepared = prepareImagePromptForModel(
    "gpt-image-1.5",
    "Create an NSFW boudoir portrait of two consenting adults in soft golden light."
  );

  assert.match(prepared.prompt, /consenting adults/i);
  assert.match(prepared.prompt, /non-consensual/i);
  assert.match(prepared.prompt, /deceptive likeness/i);
});

test("Gemini image prompts add safety guidance only for likely NSFW requests", () => {
  const prepared = prepareImagePromptForModel(
    "gemini-3-pro-image-preview",
    "Generate a tasteful NSFW editorial photo of an adult model in a luxury suite."
  );

  assert.match(prepared.prompt, /respect gemini safety settings/i);
  assert.match(prepared.prompt, /sexually explicit/i);
  assert.match(prepared.prompt, /child safety/i);
});

test("Non-NSFW prompts remain unchanged for non-Flux models", () => {
  const prepared = prepareImagePromptForModel(
    "gpt-image-1.5",
    "Create a ceramic teapot on a walnut table beside morning window light."
  );

  assert.equal(
    prepared.prompt,
    "Create a ceramic teapot on a walnut table beside morning window light."
  );
  assert.equal(prepared.negativePrompt, undefined);
});

test("Chat provider policy hint only appears when selected image models need it", () => {
  const hint = buildProviderPolicyHintForImageModels([
    "gpt-image-1.5",
    "gemini-3-pro-image-preview",
  ]);

  assert.match(hint, /OpenAI GPT Image/i);
  assert.match(hint, /Gemini Nano Banana/i);
  assert.equal(buildProviderPolicyHintForImageModels(["flux"]), "");
});

test("Queue selection starts multiple image jobs without blocking on one queued image", () => {
  const jobs = getQueuedJobsToStart(
    [
      { id: "img-running", status: "running", mode: "image" },
      { id: "img-1", status: "queued", mode: "image" },
      { id: "img-2", status: "queued", mode: "image" },
      { id: "video-1", status: "queued", mode: "video" },
      { id: "audio-1", status: "queued", mode: "tts" },
    ],
    {
      maxConcurrentImageJobs: 3,
      maxConcurrentNonImageJobs: 1,
    }
  );

  assert.deepEqual(
    jobs.map((job) => job.id),
    ["img-1", "img-2", "video-1"]
  );
});

test("Generated images are merged in requested model order instead of completion order", () => {
  const ordered = mergeGeneratedImagesInDisplayOrder(
    [
      {
        id: "late-finish",
        dataUrl: "data:image/png;base64,bbb",
        mimeType: "image/png",
        batchCreatedAt: "2026-04-15T09:00:00.000Z",
        batchOrder: 1,
        imageOrder: 0,
      },
    ],
    [
      {
        id: "early-order",
        dataUrl: "data:image/png;base64,aaa",
        mimeType: "image/png",
        batchCreatedAt: "2026-04-15T09:00:00.000Z",
        batchOrder: 0,
        imageOrder: 0,
      },
    ]
  );

  assert.deepEqual(
    ordered.map((image) => image.id),
    ["early-order", "late-finish"]
  );
});

test("Navy pending statuses are recognized consistently", () => {
  assert.equal(isNavyGenerationPending("processing"), true);
  assert.equal(isNavyGenerationPending("completed"), false);
  assert.equal(isNavyGenerationPending("succeeded"), false);
});

test("Auto image sizing omits aspect and size fields for providers that support model-defined sizing", () => {
  assert.deepEqual(
    resolveImageSizingOptions("gemini", {
      imageAspect: "auto",
      imageSize: "auto",
      navyImageSize: "auto",
    }),
    {}
  );

  assert.deepEqual(
    resolveImageSizingOptions("openrouter", {
      imageAspect: "auto",
      imageSize: "auto",
      navyImageSize: "auto",
    }),
    {}
  );

  assert.deepEqual(
    resolveImageSizingOptions("navy", {
      imageAspect: "auto",
      imageSize: "auto",
      navyImageSize: "auto",
    }),
    {}
  );
});

test("Explicit image sizing preserves the selected override values", () => {
  assert.deepEqual(
    resolveImageSizingOptions("gemini", {
      imageAspect: "16:9",
      imageSize: "2K",
      navyImageSize: "auto",
    }),
    {
      aspectRatio: "16:9",
      imageSize: "2K",
    }
  );

  assert.deepEqual(
    resolveImageSizingOptions("navy", {
      imageAspect: "3:4",
      imageSize: "auto",
      navyImageSize: "1024x1024",
    }),
    {
      aspectRatio: "3:4",
      size: "1024x1024",
    }
  );
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
