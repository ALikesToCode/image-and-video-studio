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

test("NanoGPT image route posts normalized capability-safe requests", async () => {
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

    assert.equal(url, "https://nano-gpt.com/api/v1/images");
    return Response.json({
      created: 123,
      cost: 0.003,
      paymentSource: "USD",
      remainingBalance: 4.25,
      data: [{ b64_json: "bmFubw==", mime_type: "image/png" }],
    }, { headers: { "x-request-id": "req_nano_123" } });
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
          modelCapabilities: {
            supportedResolutions: ["1024x1024", "auto"],
            maxOutputImages: 1,
            fixedOutputImages: 1,
            maxReferenceImages: 1,
            supportsReferenceImages: true,
          },
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer nano-secret");
    assert.deepEqual(requestBody, {
      model: "step-image-edit-2",
      prompt: "Edit the lighting",
      n: 1,
      resolution: "1024x1024",
      seed: 42,
      input_references: ["data:image/png;base64,cmVm"],
    });
    assert.deepEqual(payload, {
      images: [{ data: "bmFubw==", mimeType: "image/png", model: "step-image-edit-2" }],
      billing: {
        cost: 0.003,
        paymentSource: "USD",
        remainingBalance: 4.25,
      },
      requestId: "req_nano_123",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("NanoGPT image route clamps outputs and references to discovered limits", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ data: [{ url: "https://cdn.example.test/image.png" }] });
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
          model: "qwen-image",
          prompt: "Combine the references",
          resolution: "1024x1024",
          numberOfImages: 20,
          input_references: [
            "https://assets.example.test/one.png",
            "data:image/png;base64,dHdv",
            { image_url: { url: "https://assets.example.test/three.png" } },
            "https://assets.example.test/four.png",
          ],
          modelCapabilities: {
            supportedResolutions: ["auto", "1024x1024"],
            maxOutputImages: 4,
            maxReferenceImages: 3,
            supportsReferenceImages: true,
          },
        }),
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(requestBody, {
      model: "qwen-image",
      prompt: "Combine the references",
      n: 4,
      resolution: "1024x1024",
      input_references: [
        "https://assets.example.test/one.png",
        "data:image/png;base64,dHdv",
        "https://assets.example.test/three.png",
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NanoGPT image route rejects unsupported discovered resolutions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("upstream fetch must not run");
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
          model: "hidream",
          prompt: "A mountain observatory",
          resolution: "4096x4096",
          modelCapabilities: {
            supportedResolutions: ["1024x1024", "1360x768"],
            maxOutputImages: 20,
            maxReferenceImages: 0,
            supportsReferenceImages: false,
          },
        }),
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Resolution 4096x4096 is not supported by hidream.",
      code: "unsupported_resolution",
      parameter: "resolution",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NanoGPT image route drops references for text-only models", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ data: [{ b64_json: "dGV4dC1vbmx5" }] });
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
          model: "z-image-turbo",
          prompt: "A quiet library",
          imageDataUrl: "data:image/png;base64,aWdub3Jl",
          modelCapabilities: {
            maxOutputImages: 4,
            maxReferenceImages: 0,
            supportsReferenceImages: false,
          },
        }),
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(requestBody && "input_references" in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
