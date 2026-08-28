import test from "node:test";
import assert from "node:assert/strict";

import { POST as chutesAudioPost } from "../../app/api/chutes/audio/route.ts";
import { POST as chutesImagePost } from "../../app/api/chutes/image/route.ts";
import { POST as chutesVideoPost } from "../../app/api/chutes/video/route.ts";
import { POST as navyTtsPost } from "../../app/api/navy/tts/route.ts";
import { POST as openRouterImagePost } from "../../app/api/openrouter/image/route.ts";

const withFetch = async (
  fetchImpl: typeof fetch,
  run: () => Promise<void>
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("Chutes audio route rejects non-audio provider bodies", async () => {
  await withFetch(
    async () =>
      new Response("provider error page", {
        headers: { "content-type": "text/html" },
      }),
    async () => {
      const response = await chutesAudioPost(
        new Request("https://studio.test/api/chutes/audio", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-api-key": "chutes-secret",
          },
          body: JSON.stringify({ text: "Hello", model: "kokoro" }),
        })
      );

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "Chutes returned invalid audio data.",
      });
    }
  );
});

test("Chutes video route rejects provider bodies above its declared limit", async () => {
  await withFetch(
    async () =>
      new Response(Uint8Array.from([1]), {
        headers: {
          "content-length": String(256 * 1024 * 1024 + 1),
          "content-type": "video/mp4",
        },
      }),
    async () => {
      const response = await chutesVideoPost(
        new Request("https://studio.test/api/chutes/video", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-api-key": "chutes-secret",
          },
          body: JSON.stringify({
            prompt: "A lighthouse",
            image: "data:image/png;base64,AQID",
          }),
        })
      );

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "Chutes returned invalid video data.",
      });
    }
  );
});

test("Chutes image route rejects active image formats", async () => {
  await withFetch(
    async () =>
      new Response("<svg></svg>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    async () => {
      const response = await chutesImagePost(
        new Request("https://studio.test/api/chutes/image", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-api-key": "chutes-secret",
          },
          body: JSON.stringify({ prompt: "A lighthouse" }),
        })
      );

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "Chutes returned invalid image data.",
      });
    }
  );
});

test("Navy TTS route rejects non-audio provider bodies", async () => {
  await withFetch(
    async () =>
      new Response("provider error page", {
        headers: { "content-type": "text/plain" },
      }),
    async () => {
      const response = await navyTtsPost(
        new Request("https://studio.test/api/navy/tts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-api-key": "navy-secret",
          },
          body: JSON.stringify({
            model: "tts-1",
            input: "Hello",
            voice: "alloy",
          }),
        })
      );

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "NavyAI returned invalid audio data.",
      });
    }
  );
});

test("Chutes image route rejects malformed inline provider output", async () => {
  await withFetch(
    async () =>
      Response.json({
        image: "not base64!",
        mimeType: "image/png",
        url: "file:///tmp/result.png",
      }),
    async () => {
      const response = await chutesImagePost(
        new Request("https://studio.test/api/chutes/image", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-api-key": "chutes-secret",
          },
          body: JSON.stringify({ prompt: "A lighthouse" }),
        })
      );

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "No images were returned by the model.",
      });
    }
  );
});

test("OpenRouter image route rejects unsafe provider image URLs", async () => {
  let fetchCount = 0;
  await withFetch(
    async () => {
      fetchCount += 1;
      return Response.json({
        choices: [
          {
            message: {
              images: [
                { image_url: { url: "javascript:alert(1)" } },
                { image_url: { url: "data:image/svg+xml;base64,AQID" } },
              ],
            },
          },
        ],
      });
    },
    async () => {
      const response = await openRouterImagePost(
        new Request("https://studio.test/api/openrouter/image", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-api-key": "openrouter-secret",
          },
          body: JSON.stringify({
            model: "google/gemini-image",
            prompt: "A lighthouse",
          }),
        })
      );

      assert.equal(response.status, 502);
      assert.equal(fetchCount, 1);
      assert.deepEqual(await response.json(), {
        error: "No valid images were returned by the model.",
      });
    }
  );
});
