import assert from "node:assert/strict";
import test from "node:test";

import { POST as multiLlmImagePost } from "../../app/api/multillm/image/route.ts";
import { POST as nanoGptVideoPost } from "../../app/api/nanogpt/video/route.ts";
import { POST as navyTtsPost } from "../../app/api/navy/tts/route.ts";
import { POST as openRouterImagePost } from "../../app/api/openrouter/image/route.ts";

const oversizedRequest = (path: string) =>
  new Request(`https://studio.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(72 * 1024 * 1024 + 1),
    },
    body: "{}",
  });

test("proxy routes reject oversized JSON before provider work", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  globalThis.fetch = async () => {
    providerCalled = true;
    return new Response(null, { status: 500 });
  };

  try {
    const responses = await Promise.all([
      multiLlmImagePost(oversizedRequest("/api/multillm/image")),
      nanoGptVideoPost(oversizedRequest("/api/nanogpt/video")),
      navyTtsPost(oversizedRequest("/api/navy/tts")),
      openRouterImagePost(oversizedRequest("/api/openrouter/image")),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status),
      [413, 413, 413, 413],
    );
    assert.equal(providerCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
