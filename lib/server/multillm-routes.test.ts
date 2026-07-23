import test from "node:test";
import assert from "node:assert/strict";

import {
  GET as multiLlmModelsGet,
} from "../../app/api/multillm/models/route.ts";
import {
  POST as multiLlmImagePost,
} from "../../app/api/multillm/image/route.ts";
import {
  GET as multiLlmVideoGet,
  POST as multiLlmVideoPost,
} from "../../app/api/multillm/video/route.ts";
import {
  POST as multiLlmAudioPost,
} from "../../app/api/multillm/audio/route.ts";

const ENV_KEYS = [
  "MULTILLM_API_KEY",
  "PROXY_BASE_URL",
  "MULTILLM_PROXY_BASE_URL",
] as const;

const withMultiLlmEnv = async (run: () => Promise<void>) => {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MULTILLM_API_KEY = "server-proxy-secret";
  process.env.PROXY_BASE_URL = "https://proxy.test";
  delete process.env.MULTILLM_PROXY_BASE_URL;
  try {
    await run();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const withFetch = async (
  handler: typeof globalThis.fetch,
  run: () => Promise<void>
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("MultiLLM model discovery keeps healthy provider catalogs", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async (input, init) => {
        const url = String(input);
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret"
        );
        if (url === "https://proxy.test/navyai/v1/models") {
          return Response.json({
            data: [
              {
                id: "flux",
                name: "Flux",
                endpoint: "images/generations",
              },
            ],
          });
        }
        assert.equal(
          url,
          "https://proxy.test/nanogpt/v1/image-models?detailed=true"
        );
        return new Response("NanoGPT catalog unavailable", { status: 503 });
      },
      async () => {
        const response = await multiLlmModelsGet(
          new Request("https://studio.test/api/multillm/models?kind=image")
        );
        const payload = (await response.json()) as {
          models: Array<{ id: string; provider: string }>;
          warnings: string[];
        };

        assert.equal(response.status, 200);
        assert.equal(payload.models.length, 1);
        assert.equal(payload.models[0].id, "navyai:flux");
        assert.equal(payload.models[0].provider, "multillm");
        assert.equal(payload.warnings.length, 1);
        assert.match(payload.warnings[0], /NanoGPT catalog unavailable/);
      }
    );
  });
});

test("MultiLLM image generation strips the source prefix and returns base64 data", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/navyai/v1/images/generations"
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret"
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          data: [{ b64_json: "aGVsbG8=", mime_type: "image/png" }],
        });
      },
      async () => {
        const response = await multiLlmImagePost(
          new Request("https://studio.test/api/multillm/image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:flux",
              prompt: "A lighthouse in a storm",
              numberOfImages: 2,
              size: "1024x1024",
              sync: true,
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.deepEqual(upstreamBody, {
          model: "flux",
          prompt: "A lighthouse in a storm",
          n: 2,
          response_format: "b64_json",
          size: "1024x1024",
          sync: true,
        });
        assert.deepEqual(await response.json(), {
          images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
        });
      }
    );
  });
});

test("MultiLLM video polling never resubmits the generation job", async () => {
  await withMultiLlmEnv(async () => {
    let submitCount = 0;
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        const url = String(input);
        if (url === "https://proxy.test/navyai/v1/images/generations") {
          submitCount += 1;
          upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ id: "video-job-1", status: "processing" });
        }
        assert.equal(
          url,
          "https://proxy.test/navyai/v1/images/generations/video-job-1"
        );
        return Response.json({
          status: "completed",
          data: [{ url: "https://cdn.example.test/video.mp4" }],
        });
      },
      async () => {
        const submitResponse = await multiLlmVideoPost(
          new Request("https://studio.test/api/multillm/video", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:veo-3.1",
              prompt: "A ship crossing a glowing ocean",
              aspectRatio: "16:9",
              seconds: 8,
            }),
          })
        );
        assert.equal(submitResponse.status, 202);
        assert.deepEqual(await submitResponse.json(), {
          id: "video-job-1",
          source: "navyai",
          model: "veo-3.1",
          status: "processing",
        });

        const pollResponse = await multiLlmVideoGet(
          new Request(
            "https://studio.test/api/multillm/video?id=video-job-1&source=navyai"
          )
        );
        assert.equal(pollResponse.status, 200);
        assert.deepEqual(await pollResponse.json(), {
          done: true,
          status: "completed",
          videoUrl: "https://cdn.example.test/video.mp4",
        });
        assert.equal(submitCount, 1);
        assert.deepEqual(upstreamBody, {
          model: "veo-3.1",
          prompt: "A ship crossing a glowing ocean",
          aspect_ratio: "16:9",
          sync: false,
          seconds: 8,
        });
      }
    );
  });
});

test("MultiLLM audio generation streams provider audio", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/navyai/v1/audio/speech"
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/wav" },
        });
      },
      async () => {
        const response = await multiLlmAudioPost(
          new Request("https://studio.test/api/multillm/audio", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:tts-1",
              input: "Ready for launch.",
              voice: "alloy",
              speed: 1.1,
              responseFormat: "wav",
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "audio/wav");
        assert.deepEqual(upstreamBody, {
          model: "tts-1",
          input: "Ready for launch.",
          voice: "alloy",
          speed: 1.1,
          response_format: "wav",
        });
        assert.deepEqual(
          [...new Uint8Array(await response.arrayBuffer())],
          [1, 2, 3]
        );
      }
    );
  });
});

test("MultiLLM routes reject missing credentials before fetching", async () => {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  let fetched = false;
  try {
    await withFetch(
      async () => {
        fetched = true;
        throw new Error("fetch must not run");
      },
      async () => {
        const response = await multiLlmAudioPost(
          new Request("https://studio.test/api/multillm/audio", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:tts-1",
              input: "Hello",
            }),
          })
        );

        assert.equal(response.status, 400);
        assert.equal(fetched, false);
      }
    );
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
