import assert from "node:assert/strict";
import test from "node:test";

import { POST as chutesAudioPost } from "../../app/api/chutes/audio/route.ts";
import { POST as geminiVideoPost } from "../../app/api/gemini/video/route.ts";
import { POST as imageAgentPost } from "../../app/api/image-agent/route.ts";

const oversizedRequest = (path: string, headers: HeadersInit = {}) =>
  new Request(`https://studio.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(72 * 1024 * 1024 + 1),
      ...Object.fromEntries(new Headers(headers)),
    },
    body: "{}",
  });

test("provider routes reject oversized JSON before authentication or fetch", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  globalThis.fetch = async () => {
    providerCalled = true;
    return new Response(null, { status: 500 });
  };

  try {
    const responses = await Promise.all([
      chutesAudioPost(oversizedRequest("/api/chutes/audio")),
      geminiVideoPost(oversizedRequest("/api/gemini/video")),
      imageAgentPost(
        oversizedRequest("/api/image-agent", {
          origin: "https://janitorai.com",
        }),
      ),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status),
      [413, 413, 413],
    );
    assert.equal(providerCalled, false);
    assert.equal(
      responses[2]?.headers.get("access-control-allow-origin"),
      "https://janitorai.com",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
