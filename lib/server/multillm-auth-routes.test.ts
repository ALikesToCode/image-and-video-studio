import test from "node:test";
import assert from "node:assert/strict";

import { POST as multiLlmAudioPost } from "../../app/api/multillm/audio/route.ts";

const ENV_KEYS = [
  "MULTILLM_API_KEY",
  "PROXY_BASE_URL",
  "MULTILLM_PROXY_BASE_URL",
] as const;

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
