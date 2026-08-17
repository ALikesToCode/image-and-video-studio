import test from "node:test";
import assert from "node:assert/strict";

import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import { NAVY_CHAT_MODELS, NAVY_IMAGE_MODELS } from "./constants.ts";
import {
  buildSaferImagePromptForModel,
  buildProviderPolicyHintForImageModels,
  buildGeminiImagePayload,
  buildGeminiVideoPayload,
  buildImagePolicyRecoveryPrompt,
  buildImageRetryFallbackPrompt,
  buildNavyImageGenerationPayload,
  NAVY_JOB_POLL_INTERVAL_MS,
  NAVY_JOB_POLL_MAX_ATTEMPTS,
  buildOpenRouterImagePayload,
  extractImagePolicyViolationCategories,
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
  resolveImagePromptRecoveryChatModels,
  resolveImagePromptHelpChatModels,
  resolveImageGenerationModelPipeline,
  resolveImageSizingOptions,
  resolveActiveImageToolModels,
  resolveNavyChatImageSizing,
  groupNavyModelsByCapability,
  isValidGptImage2Size,
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
  assert.match(String(content[0]?.text), /^Use this product as reference/i);
  assert.match(
    String(content[0]?.text),
    /Gemini Nano Banana production prompt guide/i
  );
  assert.doesNotMatch(
    String(content[0]?.text),
    /Safety preflight|rewrite|Policy guardrails|policy-compliant Gemini Nano Banana/i
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

test("OpenAI GPT image prompts reframe risky visual intent before the first request", () => {
  const prompt =
    "Mythic final strike in a dark-fantasy battlefield, bloody final blow with body parts everywhere, shockwave tearing through smoke and stone, black-purple energy.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt);
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt);

  assert.match(openAi.prompt, /Mythic final strike/i);
  assert.match(openAi.prompt, /shockwave tearing through smoke and stone/i);
  assert.match(openAi.prompt, /symbolism, fashion, environment, expression, lighting, texture, composition/i);
  assert.match(openAi.prompt, /no graphic injury/i);
  assert.doesNotMatch(openAi.prompt, /bloody|body parts|gore|dismember/i);
  assert.match(gemini.prompt, /Mythic final strike/i);
  assert.match(gemini.prompt, /decisive symbolic strike/i);
  assert.match(gemini.prompt, /Gemini Nano Banana production prompt guide/i);
  assert.doesNotMatch(gemini.prompt, /bloody|body parts|gore|dismember/i);
});

test("OpenAI adult-themed image prompts keep art direction without explicit body focus", () => {
  const prompt =
    "modern anime illustration, high detail, cinematic wide-to-medium shot. Tense erotic standoff atmosphere, shattered pride, desperate longing masked as rage, looming confrontation. Sharp focus, clean anatomy, clear silhouette, no text, no watermark.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt);
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt);

  assert.match(openAi.prompt, /modern anime illustration/i);
  assert.match(openAi.prompt, /cinematic wide-to-medium shot/i);
  assert.match(openAi.prompt, /dramatic editorial tension/i);
  assert.match(openAi.prompt, /non-explicit styling/i);
  assert.doesNotMatch(openAi.prompt, /erotic|sexual focus|Safety preflight|OpenAI GPT Image rewrite|Policy guardrails/i);
  assert.match(gemini.prompt, /modern anime illustration/i);
  assert.match(gemini.prompt, /dramatic editorial tension/i);
  assert.match(gemini.prompt, /Visual constraints/i);
  assert.doesNotMatch(
    gemini.prompt,
    /erotic|Safety preflight|Gemini Nano Banana rewrite|Policy guardrails/i
  );
});

test("OpenAI GPT image prompts get production guide structure even when not policy-sensitive", () => {
  const prepared = prepareImagePromptForModel(
    "gpt-image-2",
    "Create a photorealistic ceramic teapot on a walnut table beside morning window light."
  );

  assert.match(prepared.prompt, /^Create a photorealistic ceramic teapot/i);
  assert.match(prepared.prompt, /OpenAI GPT Image production prompt guide/i);
  assert.match(prepared.prompt, /primary subject and action, defining details, composition\/camera, lighting\/mood, background\/setting, then constraints/i);
  assert.match(prepared.prompt, /background.*subordinate/i);
  assert.match(prepared.prompt, /For photorealism, preserve natural lighting, real materials, texture, and believable camera framing/i);
  assert.match(prepared.prompt, /Render only text explicitly requested/i);
  assert.match(prepared.prompt, /no watermark, no signature, no unrelated logos/i);
  assert.equal(prepared.negativePrompt, undefined);
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

  assert.match(openAiPrompt, /allowed visual goal/i);
  assert.match(openAiPrompt, /clearly adult/i);
  assert.match(geminiPrompt, /Visual constraints/i);
  assert.match(geminiPrompt, /age-appropriate portrayal/i);
  assert.match(geminiPrompt, /consensual\/non-threatening staging/i);
  assert.equal(fluxPrompt, "Create a provocative nightclub editorial portrait.");
  assert.equal(isLikelyImagePolicyError("blocked by image safety policy"), true);
});

test("Policy rejection recovery prompt preserves medium while targeting flagged categories", () => {
  const errorMessage =
    "Your request was rejected by the safety system. safety_violations=[sexual].";

  assert.deepEqual(extractImagePolicyViolationCategories(errorMessage), [
    "sexual",
  ]);

  const recoveryPrompt = buildImagePolicyRecoveryPrompt({
    model: "gpt-image-2",
    prompt: "Anime watercolor portrait of an adult nightclub singer in dramatic teal lighting.",
    errorMessage,
    nextAttempt: 2,
    maxAttempts: 4,
  });

  assert.match(recoveryPrompt, /try 2\/4/i);
  assert.match(recoveryPrompt, /sexual/i);
  assert.match(recoveryPrompt, /preserve.*art medium/i);
  assert.match(recoveryPrompt, /properly fitting/i);
  assert.match(recoveryPrompt, /watercolor portrait/i);
  assert.match(recoveryPrompt, /do not mention.*safety/i);
});

test("Prompt recovery uses the selected Navy chat model", () => {
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
    }),
    ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
    }),
    ["gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-sol",
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
      nextAttempt: 3,
    }),
    ["gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
      nextAttempt: 3,
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "chutes",
      activeModel: "Qwen/Qwen3-32B",
    }),
    ["Qwen/Qwen3-32B"]
  );
});

test("Explicit prompt help lets Luna ask Terra and Terra ask Sol", () => {
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
      requestedHelpModel: "auto",
    }),
    ["gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
      requestedHelpModel: "auto",
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
      requestedHelpModel: "sol",
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
      requestedHelpModel: "terra",
    }),
    []
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-sol",
      requestedHelpModel: "terra",
    }),
    []
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "chutes",
      activeModel: "Qwen/Qwen3-32B",
      requestedHelpModel: "auto",
    }),
    []
  );
});

test("Image prompts use semantic age bands without changing the requested life stage", () => {
  const prompt =
    "Premium anime close-up of Princess Leila, a beautiful 22-year-old woman, beside a 27-year-old man at dawn.";

  for (const model of ["gpt-image-2", "nano-banana-2"]) {
    const prepared = prepareImagePromptForModel(model, prompt).prompt;
    assert.match(prepared, /Princess Leila, a beautiful young adult woman/i);
    assert.match(prepared, /beside a young adult man/i);
    assert.doesNotMatch(prepared, /\b(?:22|27)(?:-year-old)?\b/i);
  }

  const teenagePrompt = prepareImagePromptForModel(
    "gpt-image-2",
    "A 16-year-old girl studying at a library desk."
  ).prompt;
  const teenageBrief = teenagePrompt.split("\n\n")[0] ?? "";
  assert.match(teenageBrief, /teenage girl/i);
  assert.doesNotMatch(teenageBrief, /young adult|adult woman/i);

  assert.equal(
    prepareImagePromptForModel(
      "plain-image-model",
      "A 35-year-old woman, a 55-year-old man, and a 70-year-old person."
    ).prompt,
    "An adult woman, a middle-aged man, and an older adult."
  );

  assert.equal(
    prepareImagePromptForModel(
      "plain-image-model",
      "A 100-year-old oak tree beside a cottage."
    ).prompt,
    "A 100-year-old oak tree beside a cottage."
  );
});

test("OpenAI and Nano Banana guides keep the named subject visually dominant", () => {
  const prompt =
    "Modern anime key art. Primary focus: Princess Leila facing the camera. Background: a softly lit stone room.";
  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;

  for (const prepared of [openAi, gemini]) {
    assert.match(prepared, /primary subject.*visually dominant/i);
    assert.match(prepared, /scale, sharpness, contrast, placement, and detail/i);
    assert.match(prepared, /background.*minimal.*subordinate/i);
  }
  assert.match(openAi, /OpenAI GPT Image production prompt guide/i);
  assert.match(gemini, /Gemini Nano Banana production prompt guide/i);
});

test("Deterministic image retries change the prompt while preserving its core intent", () => {
  const prompt =
    "Premium anime close-up of Princess Leila, a 22-year-old woman, in golden dawn light.";
  const second = buildImageRetryFallbackPrompt({
    model: "nano-banana-2",
    prompt,
    nextAttempt: 2,
    maxAttempts: 4,
  });
  const third = buildImageRetryFallbackPrompt({
    model: "nano-banana-2",
    prompt,
    nextAttempt: 3,
    maxAttempts: 4,
  });

  assert.notEqual(second, third);
  assert.match(second, /Princess Leila/i);
  assert.match(third, /Princess Leila/i);
  assert.match(second, /young adult woman/i);
  assert.doesNotMatch(second, /22-year-old/i);
  assert.match(second, /variation direction/i);
  assert.match(third, /subject-first production brief/i);
});

test("Policy-sensitive OpenAI and Gemini prompts become safe visual goals before the first request", () => {
  const prompt = `Create a high-detail modern anime illustration.
Main character: a 29-year-old adult woman with massive heavy J-cup breasts straining against her top and impossibly wide hips.
Outfit: skin-tight pink sports crop top with a darkened patch at the crotch.
Pose: clutching a small gym bag to her heaving chest while looking up with pleading eyes at a masked man.
Lighting: shadows emphasize hard nipples faintly outlined through her top.`;

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;
  const flux = prepareImagePromptForModel("flux.2-pro", prompt).prompt;

  assert.match(openAi, /high-detail modern anime illustration/i);
  assert.match(openAi, /clearly adult/i);
  assert.match(openAi, /fitted activewear/i);
  assert.match(openAi, /holding a small gym bag close/i);
  assert.match(openAi, /allowed visual goal/i);
  assert.match(openAi, /non-explicit styling/i);
  assert.doesNotMatch(
    openAi,
    /J-cup|hard nipples|crotch|heaving chest|pleading eyes|masked man|Safety preflight|Policy guardrails/i
  );
  assert.match(gemini, /young adult woman/i);
  assert.match(gemini, /fitted activewear/i);
  assert.match(gemini, /holding a small gym bag close/i);
  assert.match(gemini, /Visual constraints/i);
  assert.doesNotMatch(
    gemini,
    /J-cup|hard nipples|crotch|heaving chest|pleading eyes|masked man|Safety preflight|Policy guardrails/i
  );
  assert.match(flux, /J-cup|hard nipples|crotch/i);
});

test("Selected image models apply provider-safe prompt shaping and only prepare Flux structurally", () => {
  const prompt =
    "Create a high-detail anime portrait of an adult woman with a very large bust, hard nipples faintly outlined through her top, and nervous tension in a tidy bedroom.";
  const requests = prepareImageModelRequests({
    models: ["gpt-image-2", "nano-banana-2", "flux.2-pro"],
    baseBody: { size: "1024x1024" },
    prompt,
  });
  const byModel = new Map(requests.map((request) => [request.model, request.prompt]));
  const gptPrompt = byModel.get("gpt-image-2") ?? "";
  const nanoPrompt = byModel.get("nano-banana-2") ?? "";
  const fluxPrompt = byModel.get("flux.2-pro") ?? "";

  assert.match(gptPrompt, /high-detail anime portrait/i);
  assert.match(gptPrompt, /balanced hourglass figure|balanced upper-body silhouette/i);
  assert.match(gptPrompt, /subtle fabric texture/i);
  assert.match(gptPrompt, /non-explicit styling/i);
  assert.doesNotMatch(gptPrompt, /very large bust|hard nipples/i);
  assert.match(nanoPrompt, /balanced hourglass figure/i);
  assert.match(nanoPrompt, /subtle fabric texture/i);
  assert.match(nanoPrompt, /Gemini Nano Banana production prompt guide/i);
  assert.doesNotMatch(nanoPrompt, /very large bust|hard nipples/i);
  assert.doesNotMatch(gptPrompt, /OpenAI GPT Image rewrite|Safety preflight|Policy guardrails/i);
  assert.doesNotMatch(nanoPrompt, /Gemini Nano Banana rewrite|Safety preflight|Policy guardrails/i);

  assert.match(fluxPrompt, /very large bust|hard nipples/i);
  assert.match(fluxPrompt, /Desired qualities/i);
});

test("GPT image prompts normalize age-ambiguous and school-coded wording before first request", () => {
  const requests = prepareImageModelRequests({
    models: ["gpt-image-2", "grok-imagine"],
    baseBody: {},
    prompt: `"Create a high-detail modern anime illustration.

Background/setting: A spacious student council room in late afternoon.
Main character (focus): Alya, apparent age 18, slim yet curvy build, porcelain-fair skin, icy blue eyes rendered glassy and vacant with dilated pupils."`,
  });
  const byModel = new Map(requests.map((request) => [request.model, request.body.prompt]));
  const gptPrompt = String(byModel.get("gpt-image-2") ?? "");
  const grokPrompt = String(byModel.get("grok-imagine") ?? "");
  const expected = `Create a high-detail modern anime illustration.
Background/setting: A spacious student council room in late afternoon.
Main character (focus): Alya, young adult, slim yet curvy build, porcelain-fair skin, icy blue eyes rendered glassy and vacant with dilated pupils.`;

  assert.match(gptPrompt, /spacious university council room/i);
  assert.match(gptPrompt, /clearly adult/i);
  assert.match(gptPrompt, /slim, balanced build/i);
  assert.match(gptPrompt, /bright and reflective/i);
  assert.match(gptPrompt, /soft blue eyes/i);
  assert.match(gptPrompt, /allowed visual goal/i);
  assert.doesNotMatch(gptPrompt, /apparent age 18|student council|glassy|vacant|dilated|Policy guardrails/i);
  assert.equal(grokPrompt, expected);
  assert.doesNotMatch(gptPrompt, /OpenAI GPT Image rewrite|Safety preflight|Policy guardrails/i);
});

test("Threat-framed OpenAI prompts keep tension without coercive staging", () => {
  const prompt =
    "Create an anime scene with a nervous adult woman looking up with pleading eyes at a masked man in a dark doorway.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;

  assert.match(openAi, /anime scene/i);
  assert.match(openAi, /wide expressive eyes/i);
  assert.match(openAi, /mysterious figure/i);
  assert.match(openAi, /consensual\/non-threatening staging/i);
  assert.doesNotMatch(openAi, /pleading eyes|masked man|Policy guardrails/i);
  assert.match(gemini, /wide expressive eyes/i);
  assert.match(gemini, /mysterious figure/i);
  assert.match(gemini, /Visual constraints/i);
  assert.doesNotMatch(gemini, /pleading eyes|masked man/i);
  assert.doesNotMatch(openAi, /Safety preflight|rewrite|Policy guardrails/i);
  assert.doesNotMatch(gemini, /Safety preflight|rewrite|Policy guardrails/i);
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
  assert.match(hint, /always rephrase the image prompt before calling generate_image/i);
  assert.match(hint, /semantic visual age tags/i);
  assert.match(hint, /never exact numeric ages/i);
  assert.match(hint, /never age a minor into an adult/i);
  assert.match(hint, /primary subject and action/i);
  assert.match(hint, /background.*lowest visual priority/i);
  assert.match(hint, /do not resubmit an identical prompt/i);
  assert.match(hint, /tasteful artistic illustration/i);
  assert.match(hint, /pronounced hourglass silhouette/i);
  assert.match(hint, /silhouetted, distant, or partially visible figure/i);
  assert.match(hint, /Keep only details that can be shown visually/i);
  assert.match(hint, /Do not render long paragraphs of text inside the image/i);
  assert.match(hint, /translate it into a strong visual metaphor/i);
  assert.match(hint, /translate risky intent into a safe visual language/i);
  assert.match(hint, /Preserve the theme through symbolism/i);
  assert.match(hint, /Do not try to bypass provider moderation/i);
  assert.equal(hint.includes("exception to AI"), false);
  assert.equal(hint.includes("violent act"), false);
  assert.equal(hint.includes("explicit/visceral/graphic"), false);
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
