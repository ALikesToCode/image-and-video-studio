import test from "node:test";
import assert from "node:assert/strict";

import {
  OPTIONS as chutesImageOptions,
  POST as chutesImagePost,
} from "../../app/api/chutes/image/route.ts";
import { GET as navyImageGet } from "../../app/api/navy/image/route.ts";

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

test("Chutes image route accepts userscript CORS and Authorization bearer keys", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = temporarilyUnsetEnv(["CHUTES_API_KEY"]);
  let authorization: string | null = null;

  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return Response.json({
      image: "data:image/png;base64,Y2h1dGVz",
      mimeType: "image/png",
    });
  };

  try {
    const response = await chutesImagePost(
      new Request("https://studio.test/api/chutes/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-janitorai-source": "userscript",
          authorization: "Bearer chutes-user-secret",
          origin: "https://janitorai.com",
        },
        body: JSON.stringify({
          source: "janitorai",
          prompt: "Inline generation",
          model: "z-image-turbo",
          width: 1024,
          height: 1024,
          seed: null,
          returnImage: true,
          responseFormat: "json",
          negativePrompt: "",
          guidanceScale: 0,
          numInferenceSteps: 9,
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://janitorai.com"
    );
    assert.equal(authorization, "Bearer chutes-user-secret");
    assert.equal(payload.imageUrl, "data:image/png;base64,Y2h1dGVz");
    assert.equal(payload.model, "z-image-turbo");
    assert.deepEqual(payload.images, [
      {
        data: "Y2h1dGVz",
        mimeType: "image/png",
        model: "z-image-turbo",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("Chutes image route OPTIONS allows JanitorAI userscript headers", async () => {
  const response = await chutesImageOptions(
    new Request("https://studio.test/api/chutes/image", {
      method: "OPTIONS",
      headers: { origin: "https://janitorai.com" },
    })
  );
  const allowHeaders = response.headers.get("access-control-allow-headers") ?? "";

  assert.equal(response.status, 204);
  assert.match(allowHeaders, /authorization/i);
  assert.match(allowHeaders, /x-janitorai-source/i);
  assert.match(allowHeaders, /x-user-api-key/i);
});

test("Navy image GET accepts Authorization bearer keys and returns imageUrl when done", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = temporarilyUnsetEnv(["NAVY_API_KEY", "NAVYAI_API_KEY"]);
  let authorization: string | null = null;

  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return Response.json({
      status: "completed",
      model: "flux",
      data: [{ b64_json: "bmF2eQ==", mimeType: "image/png" }],
    });
  };

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_123", {
        method: "GET",
        headers: {
          authorization: "Bearer navy-user-secret",
          "x-janitorai-source": "userscript",
          origin: "https://janitorai.com",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer navy-user-secret");
    assert.equal(payload.done, true);
    assert.equal(payload.imageUrl, "data:image/png;base64,bmF2eQ==");
    assert.equal(payload.model, "flux");
    assert.deepEqual(payload.images, [
      {
        data: "bmF2eQ==",
        mimeType: "image/png",
        model: "flux",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
