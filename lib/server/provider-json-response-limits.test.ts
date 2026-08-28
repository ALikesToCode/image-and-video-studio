import assert from "node:assert/strict";
import test from "node:test";

import { GET as falModelsGet } from "../../app/api/fal/models/route.ts";
import { POST as chutesVideoPost } from "../../app/api/chutes/video/route.ts";
import { POST as multiLlmImagePost } from "../../app/api/multillm/image/route.ts";

const oversizedJsonResponse = () =>
  new Response("{}", {
    headers: {
      "content-type": "application/json",
      "content-length": String(72 * 1024 * 1024 + 1),
    },
  });

test("media proxies reject oversized provider JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => oversizedJsonResponse();

  try {
    const multiLlmResponse = await multiLlmImagePost(
      new Request("https://studio.test/api/multillm/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "proxy-secret",
        },
        body: JSON.stringify({
          model: "aihubmix:gpt-image-2-free",
          prompt: "A lighthouse at dawn",
        }),
      }),
    );
    const chutesResponse = await chutesVideoPost(
      new Request("https://studio.test/api/chutes/video", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "chutes-secret",
        },
        body: JSON.stringify({
          prompt: "Clouds moving above a lighthouse",
          image: "data:image/png;base64,AQID",
        }),
      }),
    );

    assert.equal(multiLlmResponse.status, 502);
    assert.equal(chutesResponse.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("catalog proxies redact credentials from upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Authorization: Bearer fal-secret" } },
      { status: 401 },
    );

  try {
    const response = await falModelsGet(
      new Request("https://studio.test/api/fal/models", {
        headers: { "x-user-api-key": "fal-secret" },
      }),
    );
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 401);
    assert.equal(payload.error?.includes("fal-secret"), false);
    assert.match(payload.error ?? "", /redacted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
