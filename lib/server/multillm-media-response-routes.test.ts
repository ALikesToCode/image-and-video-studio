import test from "node:test";
import assert from "node:assert/strict";

import { POST as multiLlmAudioPost } from "../../app/api/multillm/audio/route.ts";
import { POST as multiLlmImagePost } from "../../app/api/multillm/image/route.ts";
import { POST as multiLlmVideoPost } from "../../app/api/multillm/video/route.ts";

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

test("MultiLLM media routes reject invalid provider body types", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async (input) => {
        const url = String(input);
        if (url.endsWith("/audio/speech")) {
          return new Response("provider error page", {
            headers: { "content-type": "text/html" },
          });
        }
        if (url.endsWith("/images/generations")) {
          return new Response("<svg></svg>", {
            headers: { "content-type": "image/svg+xml" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      async () => {
        const audioResponse = await multiLlmAudioPost(
          new Request("https://studio.test/api/multillm/audio", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:tts-1",
              input: "Hello",
            }),
          })
        );
        const imageResponse = await multiLlmImagePost(
          new Request("https://studio.test/api/multillm/image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:flux",
              prompt: "A lighthouse",
            }),
          })
        );

        assert.equal(audioResponse.status, 502);
        assert.equal(imageResponse.status, 502);
        assert.deepEqual(await audioResponse.json(), {
          error: "MultiLLM returned invalid audio data.",
        });
        assert.deepEqual(await imageResponse.json(), {
          error: "MultiLLM returned invalid image data.",
          code: "image_result_unavailable",
        });
      }
    );
  });
});

test("MultiLLM video route rejects a provider body above its declared limit", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async () =>
        new Response(Uint8Array.from([1]), {
          headers: {
            "content-length": String(256 * 1024 * 1024 + 1),
            "content-type": "video/mp4",
          },
        }),
      async () => {
        const response = await multiLlmVideoPost(
          new Request("https://studio.test/api/multillm/video", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:veo-3.1",
              prompt: "A lighthouse",
            }),
          })
        );

        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          error: "MultiLLM returned invalid video data.",
        });
      }
    );
  });
});
