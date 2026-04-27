import test from "node:test";
import assert from "node:assert/strict";

import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import {
  buildSaferImagePromptForModel,
  buildProviderPolicyHintForImageModels,
  buildGeminiImagePayload,
  buildGeminiVideoPayload,
  buildNavyImageGenerationPayload,
  buildOpenRouterImagePayload,
  buildChutesChatSystemPrompt,
  extractOpenRouterImageModels,
  getActiveJobCount,
  getQueuedJobsToStart,
  mergeGeneratedImagesInDisplayOrder,
  normalizeImageModelOrder,
  prepareImageModelRequests,
  prepareImagePromptForModel,
  resolveImageGenerationModelPipeline,
  resolveImageSizingOptions,
  resolveActiveImageToolModels,
  resolveNavyChatImageSizing,
  groupNavyModelsByCapability,
  isLikelyImagePolicyError,
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

test("OpenRouter model extraction preserves pricing and modality metadata", () => {
  const models = extractOpenRouterImageModels({
    data: [
      {
        id: "google/gemini-3.1-flash-image-preview",
        name: "Gemini 3.1 Flash Image Preview",
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text", "image"],
        },
        pricing: { prompt: "0.000001" },
      },
    ],
  });

  assert.equal(models[0]?.id, "google/gemini-3.1-flash-image-preview");
  assert.deepEqual(models[0]?.inputModalities, ["text", "image"]);
  assert.deepEqual(models[0]?.outputModalities, ["text", "image"]);
  assert.deepEqual(models[0]?.pricing, { prompt: "0.000001" });
});

test("Gemini image payload keeps Imagen separate from Gemini edit payloads", () => {
  const imagen = buildGeminiImagePayload({
    model: "imagen-4.0-generate-001",
    prompt: "A product photo",
    aspectRatio: "1:1",
    imageSize: "2K",
    numberOfImages: 2,
    referenceImages: [{ dataUrl: "data:image/png;base64,YWJj" }],
  });

  assert.match(imagen.endpoint, /:predict$/);
  const imagenPayload = imagen.payload as {
    instances: Array<{ prompt: string }>;
    parameters: Record<string, unknown>;
  };
  assert.match(imagenPayload.instances[0]?.prompt ?? "", /A product photo/);
  assert.match(imagenPayload.instances[0]?.prompt ?? "", /Safety preflight/i);
  assert.deepEqual(imagenPayload.parameters, {
    sampleCount: 2,
    aspectRatio: "1:1",
    imageSize: "2K",
  });

  const gemini = buildGeminiImagePayload({
    model: "gemini-3.1-flash-image-preview",
    prompt: "Edit this into a product hero image",
    referenceImages: [{ dataUrl: "data:image/png;base64,YWJj" }],
  });
  const parts = (gemini.payload as {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
  }).contents[0]?.parts;

  assert.match(gemini.endpoint, /:generateContent$/);
  assert.match(String(parts?.[0]?.text), /Edit this into a product hero image/);
  assert.match(String(parts?.[0]?.text), /policy-compliant Gemini Nano Banana image prompt/i);
  assert.deepEqual(parts?.[1], {
    inline_data: {
      mime_type: "image/png",
      data: "YWJj",
    },
  });
});

test("OpenRouter image payload puts text first before image references", () => {
  const payload = buildOpenRouterImagePayload({
    model: "google/gemini-2.5-flash-image-preview",
    prompt: "Use this product as reference",
    outputModalities: ["text", "image"],
    aspectRatio: "16:9",
    imageSize: "1024x1024",
    referenceImages: [{ dataUrl: "data:image/jpeg;base64,ZA==" }],
  });

  assert.deepEqual(payload.modalities, ["image", "text"]);
  assert.deepEqual(payload.image_config, {
    aspect_ratio: "16:9",
    image_size: "1024x1024",
  });
  const content = (payload.messages[0] as {
    content: Array<Record<string, unknown>>;
  }).content;
  assert.equal(content[0]?.type, "text");
  assert.match(String(content[0]?.text), /Use this product as reference/);
  assert.match(String(content[0]?.text), /policy-compliant Gemini Nano Banana image prompt/i);
  assert.deepEqual(content[1], {
    type: "image_url",
    image_url: { url: "data:image/jpeg;base64,ZA==" },
  });
});

test("Gemini Veo payload carries source and last-frame images and normalizes duration", () => {
  const payload = buildGeminiVideoPayload({
    prompt: "A slow cinematic push-in",
    aspectRatio: "16:9",
    resolution: "1080p",
    durationSeconds: "4",
    sourceImage: "data:image/png;base64,YWJj",
    lastFrameImage: "data:image/jpeg;base64,ZA==",
  });

  assert.equal(payload.parameters.durationSeconds, "8");
  assert.deepEqual(payload.instances[0]?.image, {
    inlineData: {
      mimeType: "image/png",
      data: "YWJj",
    },
  });
  assert.deepEqual(payload.instances[0]?.lastFrame, {
    inlineData: {
      mimeType: "image/jpeg",
      data: "ZA==",
    },
  });
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
  assert.match(payload.prompt, /^Artwork direction: A naval command room at dusk\./);
  assert.match(payload.prompt, /artifact-free rendering/i);
  assert.match(payload.prompt, /clean surfaces without embedded typography or branding/i);
});

test("Navy image payload folds negative prompts into prompt text for non-Flux models", () => {
  const payload = buildNavyImageGenerationPayload({
    model: "gpt-image-1.5",
    prompt: "A polished anime apartment lobby scene.",
    negativePrompt: "watermark, bad hands",
  });

  assert.equal("negative_prompt" in payload, false);
  assert.match(payload.prompt, /A polished anime apartment lobby scene\./i);
  assert.match(payload.prompt, /Avoid these visual issues: watermark, bad hands\./i);
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

test("Flux prompt preparation converts short raw prompts into artwork direction", () => {
  const prepared = prepareImagePromptForModel(
    "flux",
    "red cube on a white background"
  );

  assert.match(
    prepared.prompt,
    /^Artwork direction: red cube on a white background\./
  );
  assert.match(prepared.prompt, /Desired qualities:/);
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

test("Image model order persistence keeps temporarily unavailable model ids", () => {
  assert.deepEqual(
    normalizeImageModelOrder([
      " gpt-image-2 ",
      "flux.2-pro",
      "gpt-image-2",
      "",
      null,
      "nano-banana-2",
    ]),
    ["gpt-image-2", "flux.2-pro", "nano-banana-2"]
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

test("OpenAI image prompts add artistic policy guidance without losing details", () => {
  const prepared = prepareImagePromptForModel(
    "gpt-image-2",
    "Create a cinematic portrait of a ceramic robot painter in a rainlit neon studio."
  );

  assert.match(prepared.prompt, /ceramic robot painter/i);
  assert.match(prepared.prompt, /policy-compliant artistic image prompt/i);
  assert.match(prepared.prompt, /Safety preflight/i);
  assert.match(prepared.prompt, /preserve all concrete subject/i);
  assert.match(prepared.prompt, /rich composition/i);
});

test("Nano Banana image prompts add artistic policy guidance", () => {
  const prepared = prepareImagePromptForModel(
    "nano-banana-2",
    "Make an ornate fantasy greenhouse with glass butterflies and mossy statues."
  );

  assert.match(prepared.prompt, /fantasy greenhouse/i);
  assert.match(prepared.prompt, /policy-compliant Gemini Nano Banana image prompt/i);
  assert.match(prepared.prompt, /Safety preflight/i);
  assert.match(prepared.prompt, /painterly visual detail/i);
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

test("Flagged OpenAI and Gemini image models get model-scoped safer retry prompts", () => {
  const openAiPrompt = buildSaferImagePromptForModel(
    "gpt-image-1.5",
    "Create a provocative nightclub editorial portrait."
  );
  const geminiPrompt = buildSaferImagePromptForModel(
    "google/gemini-2.5-flash-image-preview",
    "Create a provocative nightclub editorial portrait."
  );
  const fluxPrompt = buildSaferImagePromptForModel(
    "flux",
    "Create a provocative nightclub editorial portrait."
  );

  assert.match(openAiPrompt, /policy-compliant OpenAI image prompt/i);
  assert.match(openAiPrompt, /clearly adult/i);
  assert.match(geminiPrompt, /policy-compliant Gemini image prompt/i);
  assert.match(geminiPrompt, /child-safety/i);
  assert.equal(fluxPrompt, "Create a provocative nightclub editorial portrait.");
  assert.equal(isLikelyImagePolicyError("blocked by image safety policy"), true);
});

test("Policy-sensitive OpenAI and Gemini prompts are softened before the first request", () => {
  const prompt = `Create a high-detail modern anime illustration.
Main character: a 29-year-old adult woman with massive heavy J-cup breasts straining against her top and impossibly wide hips.
Outfit: skin-tight pink sports crop top with a darkened patch at the crotch.
Pose: clutching a small gym bag to her heaving chest while looking up with pleading eyes at a masked man.
Lighting: shadows emphasize hard nipples faintly outlined through her top.`;

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;
  const flux = prepareImagePromptForModel("flux.2-pro", prompt).prompt;

  assert.doesNotMatch(openAi, /J-cup|hard nipples|crotch|heaving chest|pleading eyes|masked man/i);
  assert.doesNotMatch(gemini, /J-cup|hard nipples|crotch|heaving chest|pleading eyes|masked man/i);
  assert.doesNotMatch(openAi, /massive heavy curvy upper body|leggings fabric of the leggings/i);
  assert.doesNotMatch(gemini, /massive heavy curvy upper body|leggings fabric of the leggings/i);
  assert.match(openAi, /athletic curvy figure/i);
  assert.match(openAi, /natural fabric shading/i);
  assert.match(openAi, /clearly adult/i);
  assert.match(openAi, /tasteful editorial/i);
  assert.match(gemini, /clearly adult/i);
  assert.match(gemini, /tasteful editorial/i);
  assert.match(flux, /J-cup|hard nipples|crotch/i);
});

test("Selected image models receive separate family-specific prompt rewrites", () => {
  const requests = prepareImageModelRequests({
    models: ["gpt-image-2", "nano-banana-2", "flux.2-pro"],
    baseBody: { size: "1024x1024" },
    prompt:
      "Create a high-detail anime portrait of an adult woman with a very large bust, hard nipples faintly outlined through her top, and nervous tension in a tidy bedroom.",
  });
  const byModel = new Map(requests.map((request) => [request.model, request.prompt]));
  const gptPrompt = byModel.get("gpt-image-2") ?? "";
  const nanoPrompt = byModel.get("nano-banana-2") ?? "";
  const fluxPrompt = byModel.get("flux.2-pro") ?? "";

  assert.match(gptPrompt, /OpenAI GPT Image rewrite/i);
  assert.match(gptPrompt, /tasteful editorial anime illustration/i);
  assert.match(gptPrompt, /rich composition/i);
  assert.doesNotMatch(gptPrompt, /very large bust|hard nipples/i);

  assert.match(nanoPrompt, /Gemini Nano Banana rewrite/i);
  assert.match(nanoPrompt, /painterly anime illustration/i);
  assert.match(nanoPrompt, /strong lighting/i);
  assert.doesNotMatch(nanoPrompt, /very large bust|hard nipples/i);

  assert.notEqual(gptPrompt, nanoPrompt);
  assert.match(fluxPrompt, /very large bust|hard nipples/i);
  assert.match(fluxPrompt, /Desired qualities/i);
});

test("Threat-framed OpenAI and Gemini prompts are softened before the first request", () => {
  const prompt =
    "Create an anime scene with a nervous adult woman looking up with pleading eyes at a masked man in a dark doorway.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;

  assert.doesNotMatch(openAi, /pleading eyes|masked man/i);
  assert.doesNotMatch(gemini, /pleading eyes|masked man/i);
  assert.match(openAi, /non-threatening/i);
  assert.match(gemini, /non-threatening/i);
});

test("Non-NSFW prompts remain unchanged for non-policy non-Flux models", () => {
  const prepared = prepareImagePromptForModel(
    "plain-image-model",
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

test("Navy chat image sizing ignores composition text and keeps valid dimensions", () => {
  assert.deepEqual(resolveNavyChatImageSizing("16:9"), {
    aspectRatio: "16:9",
  });
  assert.deepEqual(resolveNavyChatImageSizing("1024x1024"), {
    size: "1024x1024",
  });
  assert.deepEqual(resolveNavyChatImageSizing("medium-wide shot"), {});
  assert.deepEqual(resolveNavyChatImageSizing("slightly low angle"), {});
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
  assert.match(prompt, /always include a prompt/i);
  assert.match(prompt, /do not include a model/i);
});
