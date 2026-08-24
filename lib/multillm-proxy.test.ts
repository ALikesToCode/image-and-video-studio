import test from "node:test";
import assert from "node:assert/strict";

import { MULTILLM_CHAT_MODELS } from "./constants.ts";
import {
  extractImageItems,
  normalizeModelOptions,
  parseMediaModelId,
  parseVideoJobPayload,
  readUpstreamError,
  resolveMultiLlmChatTarget,
  resolveMultiLlmApiKey,
} from "./multillm-proxy.ts";

test("keeps LinkAPI Luna in the fallback chat catalog", () => {
  assert.ok(
    MULTILLM_CHAT_MODELS.some(
      (model) => model.id === "linkapi:gpt-5.6-luna"
    )
  );
});

test("normalizes unified chat models as MultiLLM capabilities", () => {
  const models = normalizeModelOptions({
    data: [
      { id: "opencode:deepseek-v4-flash" },
      { id: "navyai:gpt-5", name: "GPT-5" },
    ],
  });

  assert.deepEqual(
    models.map(({ id, label, provider, endpoint }) => ({
      id,
      label,
      provider,
      endpoint,
    })),
    [
      {
        id: "opencode:deepseek-v4-flash",
        label: "opencode:deepseek-v4-flash",
        provider: "multillm",
        endpoint: "multillm-chat-completions",
      },
      {
        id: "navyai:gpt-5",
        label: "GPT-5",
        provider: "multillm",
        endpoint: "multillm-chat-completions",
      },
    ]
  );
});

test("preserves unified Navy model metadata for Studio model details", () => {
  const models = normalizeModelOptions({
    data: [
      {
        id: "navyai:gemini-3.1-flash-image",
        owned_by: "navyai",
        upstream_owned_by: "google",
        provider_metadata: {
          endpoint: "/v1/chat/completions",
          token_multiplier: 45,
          premium: false,
          required_plan: null,
          context_window: 131072,
          max_output_tokens: 32768,
          input_modalities: ["text", "image"],
          output_modalities: ["text", "image"],
          modality: "text+image->text+image",
          tokenizer: "Gemini",
          supports_vision: true,
          supports_reasoning: true,
          supports_image_output: true,
          description: "Navy image-output chat model.",
          pricing: { prompt: "0.0000005", completion: "0.000003" },
          metadata_source: "openrouter",
          metadata_resolved_from: "google/gemini-image",
          metadata_status: "known",
        },
      },
    ],
  });

  const model = models[0];
  assert.equal(model?.provider, "multillm");
  assert.equal(model?.upstreamEndpoint, "/v1/chat/completions");
  assert.equal(model?.upstreamOwner, "google");
  assert.equal(model?.tokenMultiplier, 45);
  assert.equal(model?.requiredPlan, null);
  assert.equal(model?.contextWindow, 131072);
  assert.equal(model?.maxOutputTokens, 32768);
  assert.deepEqual(model?.inputModalities, ["text", "image"]);
  assert.deepEqual(model?.outputModalities, ["text", "image"]);
  assert.equal(model?.supportsVision, true);
  assert.equal(model?.supportsReasoning, true);
  assert.equal(model?.supportsImageOutput, true);
  assert.equal(model?.metadataSource, "openrouter");
  assert.equal(model?.metadataResolvedFrom, "google/gemini-image");
  assert.equal(model?.metadataStatus, "known");
  assert.deepEqual(model?.pricing, {
    prompt: "0.0000005",
    completion: "0.000003",
  });
});

test("routes catalog-declared Navy chat image models through chat transport", () => {
  const models = normalizeModelOptions(
    {
      data: [
        {
          id: "gemini-3.1-flash-image",
          owned_by: "google",
          endpoint: "/v1/chat/completions",
          input_modalities: ["text", "image"],
          output_modalities: ["text", "image"],
          supports_image_output: true,
        },
      ],
    },
    { source: "navyai", kind: "image" },
  );

  const model = models[0];
  assert.equal(model?.endpoint, "multillm-image-chat-completions");
  assert.equal(model?.upstreamEndpoint, "/v1/chat/completions");
  assert.equal(model?.upstreamOwner, "google");
  assert.equal(model?.supports?.asyncJobs, false);
  assert.equal(model?.supports?.referenceImages, true);
  assert.equal(model?.maxReferenceImages, 5);
});

test("routes LinkAPI chat models through the provider-specific endpoint", () => {
  assert.deepEqual(resolveMultiLlmChatTarget("linkapi:gpt-5.6-luna"), {
    model: "gpt-5.6-luna",
    basePath: "/linkapi/v1",
    completionPath: "/linkapi/v1/chat/completions",
    responsesPath: "/linkapi/v1/responses",
  });
  assert.deepEqual(resolveMultiLlmChatTarget("opencode:deepseek-v4-flash"), {
    model: "opencode:deepseek-v4-flash",
    basePath: "/v1",
    completionPath: "/v1/chat/completions",
    responsesPath: "/v1/responses",
  });
});

test("adds source tags and media capabilities to provider-specific models", () => {
  const models = normalizeModelOptions(
    {
      data: [
        {
          id: "veo-3.1",
          name: "Veo 3.1",
          endpoint: "/v1/images/generations",
          output_modalities: ["video"],
        },
        {
          id: "flux",
          endpoint: "/v1/images/generations",
          output_modalities: ["image"],
        },
      ],
    },
    { source: "navyai", kind: "video" }
  );

  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, "navyai:veo-3.1");
  assert.equal(models[0]?.label, "NavyAI · Veo 3.1");
  assert.equal(models[0]?.provider, "multillm");
  assert.equal(models[0]?.supports?.video, true);
  assert.equal(models[0]?.supports?.asyncJobs, true);
});

test("trusts capability-specific NanoGPT catalogs", () => {
  const models = normalizeModelOptions(
    { data: [{ id: "custom-video-model", name: "Custom Video" }] },
    { source: "nanogpt", kind: "video", assumeKind: true }
  );

  assert.equal(models[0]?.id, "nanogpt:custom-video-model");
  assert.equal(models[0]?.provider, "multillm");
  assert.deepEqual(models[0]?.outputModalities, ["video"]);
});

test("normalizes LinkAPI image models without claiming Studio edit support", () => {
  const models = normalizeModelOptions(
    { data: [{ id: "gpt-image-2-c" }] },
    { source: "linkapi", kind: "image" }
  );

  assert.equal(models[0]?.id, "linkapi:gpt-image-2-c");
  assert.equal(models[0]?.label, "LinkAPI · gpt-image-2-c");
  assert.equal(models[0]?.supports?.imageGeneration, true);
  assert.equal(models[0]?.supports?.asyncJobs, false);
  assert.equal(models[0]?.supports?.aspectRatio, false);
  assert.equal(models[0]?.maxReferenceImages, 0);
});

test("keeps all LinkAPI image catalog entries and identifies Gemini image chat models", () => {
  const models = normalizeModelOptions(
    {
      data: [
        {
          model_name: "gemini-3.1-flash-image-preview",
          supported_endpoint_types: ["gemini", "openai"],
        },
        {
          model_name: "gemini-3.1-flash-lite-image",
          supported_endpoint_types: ["gemini", "openai"],
        },
        {
          model_name: "gpt-image-2-c",
          supported_endpoint_types: ["openai", "Generate image"],
        },
        {
          model_name: "nai-diffusion-4-full",
          supported_endpoint_types: ["openai"],
        },
      ],
    },
    { source: "linkapi", kind: "image" }
  );

  assert.deepEqual(
    models.map(({ id, endpoint }) => ({ id, endpoint })),
    [
      {
        id: "linkapi:gemini-3.1-flash-image-preview",
        endpoint: "multillm-image-chat-completions",
      },
      {
        id: "linkapi:gemini-3.1-flash-lite-image",
        endpoint: "multillm-image-chat-completions",
      },
      {
        id: "linkapi:gpt-image-2-c",
        endpoint: "multillm-images-generations",
      },
      {
        id: "linkapi:nai-diffusion-4-full",
        endpoint: "multillm-images-generations",
      },
    ]
  );
  assert.deepEqual(models[0]?.inputModalities, ["text", "image"]);
  assert.deepEqual(models[0]?.outputModalities, ["text", "image"]);
  assert.equal(models[0]?.supports?.referenceImages, true);
  assert.equal(models[0]?.maxReferenceImages, 5);
});

test("does not treat audio-input chat models as speech generators", () => {
  const models = normalizeModelOptions(
    {
      data: [
        {
          id: "vision-chat",
          endpoint: "/v1/chat/completions",
          supports_audio_input: true,
        },
        {
          id: "tts-1",
          endpoint: "/v1/audio/speech",
        },
        {
          id: "whisper-1",
          type: "speech-to-text transcription",
        },
      ],
    },
    { source: "navyai", kind: "audio" }
  );

  assert.deepEqual(
    models.map((model) => model.id),
    ["navyai:tts-1"]
  );
});

test("parses only supported source-tagged media ids", () => {
  assert.deepEqual(parseMediaModelId("nanogpt:hidream"), {
    source: "nanogpt",
    model: "hidream",
  });
  assert.deepEqual(parseMediaModelId("linkapi:gpt-image-2-c"), {
    source: "linkapi",
    model: "gpt-image-2-c",
  });
  assert.throws(() => parseMediaModelId("hidream"), /source prefix/);
});

test("normalizes completed and failed media jobs", () => {
  assert.deepEqual(
    parseVideoJobPayload({
      data: {
        status: "COMPLETED",
        output: { video: { url: "https://media.example/video.mp4" } },
      },
    }),
    {
      done: true,
      status: "completed",
      videoUrl: "https://media.example/video.mp4",
    }
  );
  assert.deepEqual(
    parseVideoJobPayload({
      data: [{ url: "https://media.example/from-array.mp4" }],
      status: "completed",
    }),
    {
      done: true,
      status: "completed",
      videoUrl: "https://media.example/from-array.mp4",
    }
  );
  assert.deepEqual(
    parseVideoJobPayload({
      data: { status: "FAILED", userFriendlyError: "Prompt rejected." },
    }),
    {
      done: true,
      status: "failed",
      error: "Prompt rejected.",
    }
  );
});

test("rejects unsafe video URLs returned by MultiLLM providers", () => {
  for (const videoUrl of [
    "file:///home/user/video.mp4",
    "javascript:alert(1)",
    "http://media.example/video.mp4",
    "data:video/mp4;base64,YWJj",
    "blob:https://studio.example/stale",
  ]) {
    assert.deepEqual(
      parseVideoJobPayload({ status: "completed", videoUrl }),
      {
        done: true,
        status: "completed",
        error: "Video generation returned an unsafe media URL.",
      }
    );
  }
});

test("normalizes base64 image responses", () => {
  assert.deepEqual(
    extractImageItems({
      data: [{ b64_json: "aGVsbG8=", mime_type: "image/webp" }],
    }),
    [{ data: "aGVsbG8=", mimeType: "image/webp" }]
  );
});

test("rejects unsafe image URLs and non-image data returned by MultiLLM", () => {
  assert.deepEqual(
    extractImageItems({
      data: [
        { url: "https://media.example/image.png" },
        { url: "http://media.example/image.png" },
        { url: "file:///home/user/image.png" },
        { url: "javascript:alert(1)" },
        { url: "data:text/html;base64,YWJj" },
        { data: "YWJj", mimeType: "text/html" },
      ],
    }),
    [{ url: "https://media.example/image.png", mimeType: "image/png" }]
  );
});

test("normalizes image outputs from OpenAI-compatible chat completions", () => {
  assert.deepEqual(
    extractImageItems({
      choices: [
        {
          message: {
            images: [
              {
                type: "image_url",
                image_url: {
                  url: "data:image/webp;base64,aGVsbG8=",
                },
              },
            ],
          },
        },
      ],
    }),
    [{ data: "aGVsbG8=", mimeType: "image/webp" }]
  );
});

test("prefers the server key and redacts it from upstream errors", async () => {
  const originalKey = process.env.MULTILLM_API_KEY;
  process.env.MULTILLM_API_KEY = "server-proxy-secret";
  try {
    const request = new Request("https://studio.test/api/multillm/models", {
      headers: {
        authorization: "Bearer browser-proxy-key",
      },
    });
    assert.equal(
      resolveMultiLlmApiKey(request),
      "server-proxy-secret"
    );
    const message = await readUpstreamError(
      new Response(
        JSON.stringify({
          error: { message: "Rejected Bearer server-proxy-secret" },
        }),
        { status: 401 }
      ),
      "Proxy request failed.",
      ["server-proxy-secret"]
    );
    assert.doesNotMatch(message, /server-proxy-secret/);
  } finally {
    if (originalKey === undefined) delete process.env.MULTILLM_API_KEY;
    else process.env.MULTILLM_API_KEY = originalKey;
  }
});
