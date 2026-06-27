import test from "node:test";
import assert from "node:assert/strict";

import { POST as nanoGptImagePost } from "../../app/api/nanogpt/image/route.ts";

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

test("NanoGPT image route posts OpenAI-compatible generation requests", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  let requestBody: Record<string, unknown> | null = null;
  let authorization: string | null = null;

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    authorization = new Headers(init?.headers).get("authorization");
    requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;

    assert.equal(url, "https://nano-gpt.com/v1/images/generations");
    return Response.json({
      created: 123,
      data: [{ b64_json: "bmFubw==", mime_type: "image/png" }],
    });
  };

  try {
    const response = await nanoGptImagePost(
      new Request("https://studio.test/api/nanogpt/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "nano-secret",
        },
        body: JSON.stringify({
          model: "step-image-edit-2",
          prompt: "Edit the lighting",
          resolution: "1024x1024",
          width: 1024,
          height: 1024,
          seed: 42,
          numberOfImages: 2,
          imageUrl: ["data:image/png;base64,cmVm"],
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer nano-secret");
    assert.deepEqual(requestBody, {
      model: "step-image-edit-2",
      prompt: "Edit the lighting",
      n: 2,
      size: "1024x1024",
      response_format: "b64_json",
      seed: 42,
      imageDataUrls: ["data:image/png;base64,cmVm"],
    });
    assert.deepEqual(payload, {
      images: [{ data: "bmFubw==", mimeType: "image/png", model: "step-image-edit-2" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
