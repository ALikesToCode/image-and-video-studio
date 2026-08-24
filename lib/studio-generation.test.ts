import test from "node:test";
import assert from "node:assert/strict";

import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import { NAVY_CHAT_MODELS, NAVY_IMAGE_MODELS } from "./constants.ts";
import {
  buildNavyChatImagePayload,
  isNavyChatImageEndpoint,
} from "./navy-chat-image.ts";
import {
  buildGeminiImagePayload,
  buildGeminiVideoPayload,
  buildNavyImageGenerationPayload,
  NAVY_JOB_POLL_INTERVAL_MS,
  NAVY_JOB_POLL_MAX_ATTEMPTS,
  buildOpenRouterImagePayload,
  buildChutesChatSystemPrompt,
  extractOpenRouterImageModels,
  getActiveJobCount,
  getQueuedJobsToStart,
  mergeGeneratedImagesInDisplayOrder,
  normalizeNavyImageUrlPayload,
  resolveNavyJobPollDelayMs,
  normalizeImageModelOrder,
  normalizeImageRetryAttempts,
  prepareImageModelRequests,
  prepareImagePromptForModel,
  resolveImageGenerationModelPipeline,
  resolveImageSizingOptions,
  resolveActiveImageToolModels,
  resolveNavyChatImageSizing,
  groupNavyModelsByCapability,
  isValidGptImage2Size,
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

test("Navy capability grouping preserves new catalog metadata and buckets", () => {
  const grouped = groupNavyModelsByCapability({
    data: [
      {
        id: "gpt-5.5",
        endpoint: "/v1/chat/completions",
        token_multiplier: 12,
        premium: true,
        context_window: 1050000,
        max_output_tokens: 128000,
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text"],
        supports_reasoning: true,
        pricing: { prompt: "0.000005", completion: "0.00003" },
        metadata_status: "known",
      },
      {
        id: "image-1",
        endpoint: "/v1/images/generations",
        output_modalities: ["image"],
      },
      {
        id: "grok-4.3",
        endpoint: "/v1/chat/completions",
        token_multiplier: 3,
        output_modalities: ["text"],
      },
    ],
  });

  assert.equal(grouped.chat[0]?.id, "gpt-5.5");
  assert.equal(grouped.chat[0]?.tokenMultiplier, 12);
  assert.equal(grouped.chat[0]?.premium, true);
  assert.equal(grouped.chat[0]?.contextWindow, 1050000);
  assert.equal(grouped.chat[0]?.maxOutputTokens, 128000);
  assert.equal(grouped.chat[0]?.supportsReasoning, true);
  assert.deepEqual(grouped.chat[0]?.pricing, {
    prompt: "0.000005",
    completion: "0.00003",
  });
  assert.equal(grouped.image[0]?.id, "image-1");
  assert.equal(grouped.chat[1]?.id, "grok-4.3");
  assert.equal(grouped.chat[1]?.tokenMultiplier, 3);
});

test("Navy chat image-output models are available in both chat and image catalogs", () => {
  const grouped = groupNavyModelsByCapability({
    data: [
      {
        id: "gemini-3.1-flash-image",
        owned_by: "google",
        endpoint: "/v1/chat/completions",
        token_multiplier: 45,
        premium: false,
        context_window: 131072,
        max_output_tokens: 32768,
        input_modalities: ["text", "image"],
        output_modalities: ["text", "image"],
        supports_vision: true,
        supports_image_output: true,
        metadata_source: "openrouter",
        metadata_status: "known",
      },
    ],
  });

  assert.deepEqual(grouped.chat.map((model) => model.id), [
    "gemini-3.1-flash-image",
  ]);
  assert.deepEqual(grouped.image.map((model) => model.id), [
    "gemini-3.1-flash-image",
  ]);
  const model = grouped.image[0];
  assert.equal(model?.endpoint, "/v1/chat/completions");
  assert.equal(model?.upstreamEndpoint, "/v1/chat/completions");
  assert.equal(model?.upstreamOwner, "google");
  assert.equal(model?.tokenMultiplier, 45);
  assert.equal(model?.supports?.imageGeneration, true);
  assert.equal(model?.supports?.asyncJobs, undefined);
  assert.equal(model?.supports?.referenceImages, true);
  assert.equal(model?.maxReferenceImages, 5);
});

test("Navy current media catalog keeps every image and video model discoverable", () => {
  const chatImageModels = [
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image",
  ];
  const nativeImageModels = [
    "gpt-image-2",
    "gpt-image-1.5",
    "flux",
    "flux.1-schnell",
    "flux.2-klein",
    "z-image",
    "nano-banana-2",
    "p-image",
  ];
  const videoModels = ["veo-3.1", "gemini-omni"];
  const grouped = groupNavyModelsByCapability({
    data: [
      ...chatImageModels.map((id) => ({
        id,
        endpoint: "/v1/chat/completions",
        input_modalities: ["text", "image"],
        output_modalities: ["text", "image"],
        supports_image_output: true,
      })),
      ...nativeImageModels.map((id) => ({
        id,
        endpoint: "/v1/images/generations",
        input_modalities: ["text", "image"],
        output_modalities: ["image"],
      })),
      ...videoModels.map((id) => ({
        id,
        endpoint: "/v1/images/generations",
        input_modalities: ["text", "image"],
        output_modalities: ["video"],
      })),
    ],
  });

  assert.deepEqual(
    grouped.image.map((model) => model.id),
    [...chatImageModels, ...nativeImageModels],
  );
  assert.deepEqual(
    grouped.video.map((model) => model.id),
    videoModels,
  );
});

test("Navy chat image payload follows the catalog-declared modalities", () => {
  const payload = buildNavyChatImagePayload({
    model: "gemini-3.1-flash-image",
    prompt: "A lighthouse in a storm",
    negativePrompt: "watermark",
    numberOfImages: 2,
    size: "1024x1024",
    aspectRatio: "16:9",
    outputModalities: ["text", "image"],
    imageUrl: [
      "data:image/png;base64,AQID",
      "https://images.example/reference.png",
    ],
  });

  assert.deepEqual(payload.modalities, ["image", "text"]);
  assert.equal(payload.n, 2);
  assert.deepEqual(payload.image_config, {
    image_size: "1024x1024",
    aspect_ratio: "16:9",
  });
  const content = payload.messages[0]?.content as Array<
    Record<string, unknown>
  >;
  assert.match(String(content[0]?.text), /Avoid these visual issues: watermark/);
  assert.deepEqual(content.slice(1), [
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AQID" },
    },
    {
      type: "image_url",
      image_url: { url: "https://images.example/reference.png" },
    },
  ]);
  assert.equal(isNavyChatImageEndpoint("/v1/chat/completions/"), true);
  assert.equal(
    isNavyChatImageEndpoint("https://attacker.example/v1/chat/completions"),
    false,
  );
});

test("Navy output modalities take priority over a shared media endpoint", () => {
  const grouped = groupNavyModelsByCapability({
    data: [
      {
        id: "gemini-omni",
        endpoint: "/v1/images/generations",
        input_modalities: ["text", "image", "video"],
        output_modalities: ["video"],
        metadata_status: "known",
      },
    ],
  });

  assert.deepEqual(grouped.image, []);
  assert.deepEqual(
    grouped.video.map((model) => model.id),
    ["gemini-omni"]
  );
  assert.equal(grouped.video[0]?.supports?.video, true);
  assert.equal(grouped.video[0]?.supports?.asyncJobs, true);
});

test("Navy media capabilities use conservative per-model reference limits", () => {
  const grouped = groupNavyModelsByCapability({
    data: [
      {
        id: "flux",
        endpoint: "/v1/images/generations",
        output_modalities: ["image"],
        metadata_status: "known",
      },
      {
        id: "flux.2-klein",
        endpoint: "/v1/images/generations",
        output_modalities: ["image"],
        metadata_status: "known",
      },
      {
        id: "grok-imagine",
        endpoint: "/v1/images/generations",
        output_modalities: ["image"],
        metadata_status: "known",
      },
      {
        id: "z-image",
        endpoint: "/v1/images/generations",
        output_modalities: ["image"],
        metadata_status: "known",
      },
      {
        id: "veo-3.1",
        endpoint: "/v1/images/generations",
        output_modalities: ["video"],
        metadata_status: "known",
      },
      {
        id: "unknown-image-model",
        endpoint: "/v1/images/generations",
        output_modalities: ["image"],
        metadata_status: "unknown",
      },
      {
        id: "unknown-video-model",
        endpoint: "/v1/videos/generations",
        output_modalities: ["video"],
        metadata_status: "unknown",
      },
    ],
  });
  const media = new Map(
    [...grouped.image, ...grouped.video].map((model) => [model.id, model])
  );

  assert.equal(media.get("flux")?.maxReferenceImages, 3);
  assert.equal(media.get("flux.2-klein")?.maxReferenceImages, 3);
  assert.equal(media.get("grok-imagine")?.maxReferenceImages, 1);
  assert.equal(media.get("z-image")?.maxReferenceImages, 0);
  assert.equal(media.get("veo-3.1")?.maxReferenceImages, 3);
  assert.equal(media.get("flux")?.supports?.referenceImages, true);
  assert.equal(media.get("grok-imagine")?.supports?.sourceImage, true);
  assert.equal(media.get("z-image")?.supports?.referenceImages, false);
  assert.equal(media.get("z-image")?.supports?.sourceImage, false);
  assert.equal(media.get("unknown-image-model")?.maxReferenceImages, undefined);
  assert.equal(
    media.get("unknown-image-model")?.supports?.referenceImages,
    undefined
  );
  assert.equal(media.get("unknown-image-model")?.supports?.sourceImage, undefined);
  assert.equal(media.get("unknown-video-model")?.maxReferenceImages, undefined);
  assert.equal(
    media.get("unknown-video-model")?.supports?.referenceImages,
    undefined
  );
});

test("Static Navy image fallbacks omit models missing from the current catalog", () => {
  assert.equal(NAVY_IMAGE_MODELS.some((model) => model.id === "image-1"), false);
  assert.equal(NAVY_IMAGE_MODELS.some((model) => model.id === "dall-e-3"), false);
  assert.equal(NAVY_IMAGE_MODELS.some((model) => model.id === "gpt-image-2"), true);
  assert.equal(
    NAVY_CHAT_MODELS.find((model) => model.id === "gpt-5.5")?.tokenMultiplier,
    12
  );
  assert.equal(
    NAVY_CHAT_MODELS.find((model) => model.id === "grok-4.3")?.tokenMultiplier,
    3
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

test("Gemini image payload keeps Imagen separate from Gemini edit payloads without hidden prompt notes", () => {
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
  assert.doesNotMatch(
    imagenPayload.instances[0]?.prompt ?? "",
    /Safety preflight|rewrite|Policy guardrails/i
  );
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
  assert.doesNotMatch(
    String(parts?.[0]?.text),
    /Safety preflight|rewrite|Policy guardrails|policy-compliant Gemini Nano Banana/i
  );
  assert.deepEqual(parts?.[1], {
    inline_data: {
      mime_type: "image/png",
      data: "YWJj",
    },
  });
});

test("prompt envelope stripping avoids regex backtracking on quoted input", () => {
  const prompt = `${'"'.repeat(2000)}Create a clean product photo.${"'".repeat(2000)}`;
  assert.equal(
    prepareImagePromptForModel("custom-image-model", prompt).prompt,
    "Create a clean product photo."
  );
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
  assert.equal(String(content[0]?.text), "Use this product as reference");
  assert.doesNotMatch(
    String(content[0]?.text),
    /production prompt guide|instructions, not visible|Safety preflight|rewrite|Policy guardrails|policy-compliant Gemini Nano Banana/i
  );
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

test("Navy image payload maps supported fields to Navy API fields", () => {
  const payload = buildNavyImageGenerationPayload({
    model: "flux",
    prompt: "A naval command room at dusk",
    size: "1024x1024",
    numberOfImages: 2,
    quality: "medium",
    style: "cinematic",
    imageUrl: "https://example.com/ref.png",
    negativePrompt: "text artifacts",
    seed: 42,
    seconds: 6,
    sync: false,
    responseFormat: "url",
    aspectRatio: "16:9",
  });

  assert.equal(payload.model, "flux");
  assert.equal("n" in payload, false);
  assert.equal(payload.quality, "medium");
  assert.equal(payload.style, "cinematic");
  assert.equal(payload.image_url, "https://example.com/ref.png");
  assert.equal(payload.seed, 42);
  assert.equal(payload.seconds, 6);
  assert.equal(payload.sync, false);
  assert.equal(payload.response_format, "url");
  assert.equal(payload.size, "1024x1024");
  assert.equal("aspect_ratio" in payload, false);
  assert.equal("negative_prompt" in payload, false);
  assert.match(payload.prompt, /^Artwork direction: A naval command room at dusk\./);
  assert.match(payload.prompt, /artifact-free rendering/i);
  assert.match(payload.prompt, /clean surfaces without embedded typography or branding/i);
});

test("Navy GPT image payload omits unsupported style parameter", () => {
  const payload = buildNavyImageGenerationPayload({
    model: "gpt-image-2",
    prompt: "A naval command room at dusk",
    quality: "high",
    style: "vivid",
  });

  assert.equal(payload.model, "gpt-image-2");
  assert.equal(payload.quality, "high");
  assert.equal("style" in payload, false);
});

test("Navy GPT Image payload maps supported aspect ratios to pixel sizes", () => {
  const ratios = new Map([
    ["1:1", "1024x1024"],
    ["3:2", "1536x1024"],
    ["2:3", "1024x1536"],
  ]);

  for (const [aspectRatio, expectedSize] of ratios) {
    const payload = buildNavyImageGenerationPayload({
      model: "gpt-image-1.5",
      prompt: "A naval command room at dusk",
      aspectRatio,
    });

    assert.equal(payload.size, expectedSize);
    assert.equal("aspect_ratio" in payload, false);
    assert.equal("quality" in payload, false);
  }
});

test("Navy GPT Image payload omits unsupported ratios and preserves model defaults", () => {
  const payload = buildNavyImageGenerationPayload({
    model: "gpt-image-2",
    prompt: "A naval command room at dusk",
    aspectRatio: "16:9",
    quality: "auto",
    style: "vivid",
  });

  assert.equal("size" in payload, false);
  assert.equal("aspect_ratio" in payload, false);
  assert.equal("quality" in payload, false);
  assert.equal("style" in payload, false);
});

test("Prepared GPT image requests strip unsupported style without mutating other models", () => {
  const requests = prepareImageModelRequests({
    models: ["gpt-image-2", "flux"],
    baseBody: { quality: "high", style: "vivid" },
    prompt: "A naval command room at dusk",
  });
  const byModel = new Map(requests.map((request) => [request.model, request.body]));

  assert.equal("style" in (byModel.get("gpt-image-2") ?? {}), false);
  assert.equal(byModel.get("gpt-image-2")?.quality, "high");
  assert.equal(byModel.get("flux")?.style, "vivid");
});

test("Navy image payload uses aspect ratio when no explicit size is set", () => {
  const payload = buildNavyImageGenerationPayload({
    model: "flux",
    prompt: "A naval command room at dusk",
    aspectRatio: "16:9",
  });

  assert.equal(payload.aspect_ratio, "16:9");
  assert.equal("size" in payload, false);
});

test("Navy image payload accepts up to five reference image URLs", () => {
  assert.equal(
    normalizeNavyImageUrlPayload(" https://example.com/ref.png "),
    "https://example.com/ref.png"
  );
  assert.deepEqual(
    normalizeNavyImageUrlPayload([
      "data:image/png;base64,one",
      "data:image/png;base64,two",
      "data:image/png;base64,three",
      "data:image/png;base64,four",
      "data:image/png;base64,five",
      "data:image/png;base64,six",
    ]),
    [
      "data:image/png;base64,one",
      "data:image/png;base64,two",
      "data:image/png;base64,three",
      "data:image/png;base64,four",
      "data:image/png;base64,five",
    ]
  );

  const payload = buildNavyImageGenerationPayload({
    model: "nano-banana-2",
    prompt: "Combine these references.",
    imageUrl: [
      "data:image/png;base64,one",
      "data:image/png;base64,two",
    ],
  });

  assert.deepEqual(payload.image_url, [
    "data:image/png;base64,one",
    "data:image/png;base64,two",
  ]);
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

test("Image retry attempts normalize to a bounded tries count", () => {
  assert.equal(normalizeImageRetryAttempts(undefined), 4);
  assert.equal(normalizeImageRetryAttempts(0), 4);
  assert.equal(normalizeImageRetryAttempts("3"), 3);
  assert.equal(normalizeImageRetryAttempts(4.8), 4);
  assert.equal(normalizeImageRetryAttempts(99), 8);
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

test("Navy job polling covers the documented ten minute retention window", () => {
  assert.equal(NAVY_JOB_POLL_INTERVAL_MS, 5000);
  assert.equal(NAVY_JOB_POLL_MAX_ATTEMPTS, 120);
});

test("Navy poll delay honors retry-after payloads and rate-limit backoff", () => {
  assert.equal(
    resolveNavyJobPollDelayMs({
      payload: { retryAfterMs: 7000 },
      responseStatus: 200,
      currentDelayMs: 5000,
    }),
    7000
  );
  assert.equal(
    resolveNavyJobPollDelayMs({
      payload: {},
      responseStatus: 429,
      currentDelayMs: 20000,
    }),
    30000
  );
  assert.equal(
    resolveNavyJobPollDelayMs({
      payload: {},
      responseStatus: 200,
      currentDelayMs: 12000,
    }),
    NAVY_JOB_POLL_INTERVAL_MS
  );
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
  assert.deepEqual(resolveNavyChatImageSizing("3200x2240"), {
    size: "3200x2240",
  });
  assert.deepEqual(resolveNavyChatImageSizing("medium-wide shot"), {});
  assert.deepEqual(resolveNavyChatImageSizing("slightly low angle"), {});
});

test("GPT Image 2 size validation follows documented pixel constraints", () => {
  assert.equal(isValidGptImage2Size("3200x2240"), true);
  assert.equal(isValidGptImage2Size("3840x2160"), true);
  assert.equal(isValidGptImage2Size("512x512"), false);
  assert.equal(isValidGptImage2Size("4096x2048"), false);
  assert.equal(isValidGptImage2Size("4000x400"), false);
  assert.equal(isValidGptImage2Size("1025x1024"), false);
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
        context_window: null,
        max_output_tokens: null,
        input_modalities: null,
        output_modalities: ["image"],
        supports_vision: null,
        supports_image_output: true,
        description: null,
        pricing: {
          prompt: null,
          completion: null,
          image: null,
          request: null,
        },
        metadata_source: null,
        metadata_status: "unknown",
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
    grouped.data.map((model) => model.id),
    ["gpt-5", "flux", "veo-3.1", "gpt-4o-mini-tts", "whisper-1"]
  );
  assert.equal(grouped.image[0]?.contextWindow, null);
  assert.equal(grouped.image[0]?.maxOutputTokens, null);
  assert.equal(grouped.image[0]?.inputModalities, null);
  assert.deepEqual(grouped.image[0]?.outputModalities, ["image"]);
  assert.equal(grouped.image[0]?.supportsVision, null);
  assert.equal(grouped.image[0]?.supportsImageOutput, true);
  assert.equal(grouped.image[0]?.description, null);
  assert.deepEqual(grouped.image[0]?.pricing, {
    prompt: null,
    completion: null,
    image: null,
    request: null,
  });
  assert.equal(grouped.image[0]?.metadataSource, null);
  assert.equal(grouped.image[0]?.metadataStatus, "unknown");
  assert.equal(grouped.image[0]?.maxReferenceImages, undefined);
  assert.equal(grouped.image[0]?.supports?.referenceImages, undefined);
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
