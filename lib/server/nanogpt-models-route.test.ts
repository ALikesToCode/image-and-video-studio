import test from "node:test";
import assert from "node:assert/strict";

import { GET as nanoGptModelsGet } from "../../app/api/nanogpt/models/route.ts";

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

test("NanoGPT models route discovers and normalizes image models", async () => {
  await withFetch(
    async (input) => {
      assert.equal(
        input instanceof Request ? input.url : String(input),
        "https://nano-gpt.com/api/v1/images/models",
      );
      return Response.json({
        object: "list",
        data: [
          {
            id: "qwen-image",
            name: "Qwen Image",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["image"],
            },
            capabilities: {
              image_generation: true,
              image_to_image: true,
            },
            supported_parameters: {
              resolutions: ["auto", "1024x1024"],
              max_output_images: 4,
              max_input_images: 3,
            },
          },
        ],
        meta: { total: 1 },
      });
    },
    async () => {
      const response = await nanoGptModelsGet(
        new Request("https://studio.test/api/nanogpt/models?mode=image"),
      );
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=3600");
      assert.equal(payload.mode, "image");
      assert.equal(payload.models.length, 1);
      assert.equal(payload.models[0].id, "qwen-image");
      assert.equal(payload.models[0].maxReferenceImages, 3);
      assert.deepEqual(payload.models[0].supportedResolutions, ["auto", "1024x1024"]);
      assert.deepEqual(payload.meta, { total: 1 });
    },
  );
});

test("NanoGPT models route uses the dedicated video catalog", async () => {
  await withFetch(
    async (input) => {
      assert.equal(
        input instanceof Request ? input.url : String(input),
        "https://nano-gpt.com/api/v1/video-models",
      );
      return Response.json({
        data: [
          {
            id: "sora-2",
            name: "Sora 2",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["video"],
            },
            capabilities: { video_generation: true, image_to_video: true },
            supported_parameters: {
              parameters: {
                seconds: {
                  type: "select",
                  label: "Duration",
                  options: [{ value: "4", label: "4 seconds" }],
                  default: "4",
                },
              },
              defaults: { seconds: "4" },
            },
          },
        ],
      });
    },
    async () => {
      const response = await nanoGptModelsGet(
        new Request("https://studio.test/api/nanogpt/models?mode=video"),
      );
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.mode, "video");
      assert.equal(payload.models[0].id, "sora-2");
      assert.equal(payload.models[0].supports.video, true);
      assert.equal(payload.models[0].dynamicParameters.seconds.type, "select");
    },
  );
});

test("NanoGPT models route rejects unsupported modes before fetching", async () => {
  await withFetch(
    async () => {
      throw new Error("fetch must not run");
    },
    async () => {
      const response = await nanoGptModelsGet(
        new Request("https://studio.test/api/nanogpt/models?mode=tts"),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "NanoGPT model mode must be image or video.",
      });
    },
  );
});

test("NanoGPT models route preserves safe upstream errors", async () => {
  await withFetch(
    async () =>
      Response.json(
        { error: { message: "Catalog temporarily unavailable", code: "catalog_down" } },
        { status: 503 },
      ),
    async () => {
      const response = await nanoGptModelsGet(
        new Request("https://studio.test/api/nanogpt/models?mode=image"),
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Catalog temporarily unavailable",
        code: "catalog_down",
      });
    },
  );
});

test("NanoGPT models route handles malformed catalog JSON", async () => {
  await withFetch(
    async () => new Response("not-json", { status: 200 }),
    async () => {
      const response = await nanoGptModelsGet(
        new Request("https://studio.test/api/nanogpt/models?mode=video"),
      );
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "Unable to parse NanoGPT model catalog.",
      });
    },
  );
});
