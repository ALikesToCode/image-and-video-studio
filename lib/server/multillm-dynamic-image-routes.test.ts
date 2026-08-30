import test from "node:test";
import assert from "node:assert/strict";

import { POST as multiLlmImagePost } from "../../app/api/multillm/image/route.ts";
import { GET as multiLlmModelsGet } from "../../app/api/multillm/models/route.ts";

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
  run: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("discovers every capability-declared unified image provider", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async (input, init) => {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret",
        );
        if (String(input) === "https://proxy.test/v1/models") {
          return Response.json({
            data: [
              {
                id: "gguu:gpt-image-2",
                capabilities: { supports_images: true },
              },
              {
                id: "future-relay:artist-v2",
                capabilities: { output_modalities: ["image"] },
              },
              {
                id: "gguu:text-only",
                capabilities: { supports_images: false },
              },
            ],
          });
        }
        return Response.json({ data: [] });
      },
      async () => {
        const response = await multiLlmModelsGet(
          new Request("https://studio.test/api/multillm/models?kind=image"),
        );
        const payload = (await response.json()) as {
          models: Array<{ id: string; label: string }>;
          warnings: string[];
        };

        assert.equal(response.status, 200);
        assert.deepEqual(
          payload.models.map(({ id, label }) => ({ id, label })),
          [
            {
              id: "future-relay:artist-v2",
              label: "Future Relay · artist-v2",
            },
            {
              id: "gguu:gpt-image-2",
              label: "GGUU · gpt-image-2",
            },
          ],
        );
        assert.deepEqual(payload.warnings, []);
      },
    );
  });
});

test("routes newly discovered image providers through unified generation", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/v1/images/generations",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret",
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
              model: "gguu:gpt-image-2",
              prompt: "A glass observatory at sunrise",
              numberOfImages: 1,
              size: "3840x2160",
              quality: "high",
            }),
          }),
        );

        assert.equal(response.status, 200);
        assert.equal(upstreamBody.model, "gguu:gpt-image-2");
        assert.equal(upstreamBody.size, "3840x2160");
        assert.equal(upstreamBody.quality, "high");
        assert.equal(upstreamBody.moderation, "low");
        assert.deepEqual(await response.json(), {
          images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
        });
      },
    );
  });
});
