import test from "node:test";
import assert from "node:assert/strict";

import {
  OPTIONS as imageAgentOptions,
  POST as imageAgentPost,
} from "../../app/api/image-agent/route.ts";

const temporarilyUnsetEnv = (keys: string[]) => {
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  return () => {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

test("image-agent route generates JanitorAI images through the existing providers", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = temporarilyUnsetEnv([
    "CHUTES_API_KEY",
    "NAVY_API_KEY",
    "NAVYAI_API_KEY",
  ]);
  const providerCalls: Array<{ url: string; authorization: string | null }> = [];

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    providerCalls.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });

    if (url === "https://chutes-z-image-turbo.chutes.ai/generate") {
      return Response.json({
        image: "data:image/png;base64,Y2h1dGVz",
        mimeType: "image/png",
      });
    }

    if (url === "https://api.navy/v1/images/generations") {
      return Response.json({
        model: "flux.2-flex",
        data: [{ b64_json: "bmF2eQ==", mimeType: "image/png" }],
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await imageAgentPost(
      new Request("https://studio.test/api/image-agent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-janitorai-source": "userscript",
          "x-janitorai-agent": "image",
          authorization: "Bearer userscript-secret",
          origin: "https://janitorai.com",
        },
        body: JSON.stringify({
          source: "janitorai",
          provider: "image-agent",
          action: "generate",
          mode: "image-agent",
          view: "image-agent",
          prompt: "image prompt text",
          messages: [{ role: "user", content: "image prompt text" }],
          models: ["z-image-turbo", "flux.2-flex"],
          model: "z-image-turbo",
          width: 1024,
          height: 1024,
          seed: 456,
          steps: 9,
          maxImages: 2,
          returnImages: true,
          returnImage: true,
          responseFormat: "json",
          imagePipelineEnabled: true,
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://janitorai.com"
    );
    assert.deepEqual(
      providerCalls.map((call) => call.url),
      [
        "https://chutes-z-image-turbo.chutes.ai/generate",
        "https://api.navy/v1/images/generations",
      ]
    );
    assert.deepEqual(
      providerCalls.map((call) => call.authorization),
      ["Bearer userscript-secret", "Bearer userscript-secret"]
    );
    assert.deepEqual(payload, {
      images: [
        {
          imageUrl: "data:image/png;base64,Y2h1dGVz",
          model: "z-image-turbo",
          seedUsed: 456,
          prompt: "image prompt text",
          generationTag: "Studio Agent / z-image-turbo",
        },
        {
          imageUrl: "data:image/png;base64,bmF2eQ==",
          model: "flux.2-flex",
          seedUsed: 456,
          prompt: "image prompt text",
          generationTag: "Studio Agent / flux.2-flex",
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("image-agent route OPTIONS allows JanitorAI agent headers", async () => {
  const response = await imageAgentOptions(
    new Request("https://studio.test/api/image-agent", {
      method: "OPTIONS",
      headers: { origin: "https://janitorai.com" },
    })
  );
  const allowHeaders = response.headers.get("access-control-allow-headers") ?? "";

  assert.equal(response.status, 204);
  assert.match(allowHeaders, /authorization/i);
  assert.match(allowHeaders, /x-user-api-key/i);
  assert.match(allowHeaders, /x-janitorai-source/i);
  assert.match(allowHeaders, /x-janitorai-agent/i);
});
