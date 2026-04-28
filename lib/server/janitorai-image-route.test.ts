import test from "node:test";
import assert from "node:assert/strict";

import {
  OPTIONS as janitorImageOptions,
  POST as janitorImagePost,
} from "../../app/api/janitorai/image/route.ts";

test("JanitorAI image route forwards Chutes settings through the image pipeline", async () => {
  const originalFetch = globalThis.fetch;
  let chutesBody: Record<string, unknown> | null = null;
  let chutesAuthorization: string | null = null;

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    chutesAuthorization = new Headers(init?.headers).get("authorization");
    chutesBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;

    assert.equal(url, "https://chutes-hidream.chutes.ai/generate");
    return Response.json({
      images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
    });
  };

  try {
    const response = await janitorImagePost(
      new Request("https://studio.test/api/janitorai/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "chutes-secret",
          origin: "https://janitorai.com",
        },
        body: JSON.stringify({
          source: "janitorai",
          mode: "image",
          action: "generate",
          provider: "janitorai",
          prompt: "A bright atelier",
          model: "chutes-hidream",
          width: 768,
          height: 512,
          steps: 9,
          seed: 123,
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
    assert.equal(chutesAuthorization, "Bearer chutes-secret");
    assert.ok(chutesBody);
    const capturedChutesBody = chutesBody as Record<string, unknown>;
    assert.equal(capturedChutesBody.prompt, "A bright atelier");
    assert.equal(capturedChutesBody.resolution, "768x512");
    assert.equal(capturedChutesBody.num_inference_steps, 9);
    assert.equal(capturedChutesBody.seed, 123);
    assert.deepEqual(payload, {
      images: [
        {
          data: "aW1hZ2U=",
          mimeType: "image/png",
          model: "chutes-hidream",
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JanitorAI image route polls Navy image jobs until images are returned", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);

    if (url === "https://api.navy/v1/images/generations") {
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null;
      assert.equal(body?.model, "flux");
      assert.match(String(body?.prompt), /Artwork direction: A rainy city\./);
      assert.match(String(body?.prompt), /Desired qualities:/);
      return Response.json({ id: "job_123", status: "queued" });
    }

    if (url === "https://api.navy/v1/images/generations/job_123") {
      return Response.json({
        status: "completed",
        data: [{ b64_json: "bmF2eQ==", mimeType: "image/png" }],
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await janitorImagePost(
      new Request("https://studio.test/api/janitorai/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          source: "janitorai",
          mode: "image",
          action: "generate",
          provider: "janitorai",
          prompt: "A rainy city",
          model: "flux",
          returnImage: true,
          responseFormat: "json",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://api.navy/v1/images/generations",
      "https://api.navy/v1/images/generations/job_123",
    ]);
    assert.deepEqual(payload, {
      images: [
        {
          data: "bmF2eQ==",
          mimeType: "image/png",
          model: "flux",
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JanitorAI image route rejects missing API keys before provider calls", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };

  try {
    const response = await janitorImagePost(
      new Request("https://studio.test/api/janitorai/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "janitorai",
          mode: "image",
          action: "generate",
          provider: "janitorai",
          prompt: "No key",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, "Missing API key.");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JanitorAI image route handles browser preflight from JanitorAI", async () => {
  const response = await janitorImageOptions(
    new Request("https://studio.test/api/janitorai/image", {
      method: "OPTIONS",
      headers: { origin: "https://janitorai.com" },
    })
  );

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://janitorai.com"
  );
  assert.match(
    response.headers.get("access-control-allow-headers") ?? "",
    /x-user-api-key/i
  );
});
