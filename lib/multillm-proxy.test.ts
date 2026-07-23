import test from "node:test";
import assert from "node:assert/strict";

import {
  extractImageItems,
  normalizeModelOptions,
  parseMediaModelId,
  parseVideoJobPayload,
  readUpstreamError,
  resolveMultiLlmApiKey,
} from "./multillm-proxy.ts";

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

test("normalizes base64 image responses", () => {
  assert.deepEqual(
    extractImageItems({
      data: [{ b64_json: "aGVsbG8=", mime_type: "image/webp" }],
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
