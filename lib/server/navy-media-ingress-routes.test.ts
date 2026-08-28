import test from "node:test";
import assert from "node:assert/strict";

import { POST as navyImagePost } from "../../app/api/navy/image/route.ts";
import { POST as navyVideoPost } from "../../app/api/navy/video/route.ts";

const routeRequest = (path: string, body: Record<string, unknown>) =>
  new Request(`https://studio.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-api-key": "navy-secret",
    },
    body: JSON.stringify(body),
  });

test("Navy media routes reject unsafe image references before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("fetch must not run");
  };

  try {
    const imageResponse = await navyImagePost(
      routeRequest("/api/navy/image", {
        model: "nano-banana-2",
        prompt: "Edit the reference",
        imageUrl: "file:///tmp/reference.png",
      })
    );
    const videoResponse = await navyVideoPost(
      routeRequest("/api/navy/video", {
        model: "veo-3.1",
        prompt: "Animate the reference",
        imageUrl: "javascript:alert(1)",
      })
    );

    assert.equal(imageResponse.status, 400);
    assert.equal(videoResponse.status, 400);
    assert.equal(fetched, false);
    assert.match((await imageResponse.json()).error, /HTTPS or valid image data/i);
    assert.match((await videoResponse.json()).error, /HTTPS or valid image data/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy media routes reject more than five image references", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("fetch must not run");
  };
  const references = Array.from(
    { length: 6 },
    (_, index) => `https://example.com/reference-${index}.png`
  );

  try {
    const response = await navyImagePost(
      routeRequest("/api/navy/image", {
        model: "nano-banana-2",
        prompt: "Combine the references",
        imageUrl: references,
      })
    );

    assert.equal(response.status, 400);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
