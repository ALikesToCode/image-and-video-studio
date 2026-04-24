import test from "node:test";
import assert from "node:assert/strict";

import { POST as geminiVideoDownload } from "../../app/api/gemini/video/download/route.ts";
import { POST as navyImagePost } from "../../app/api/navy/image/route.ts";
import { POST as navyVideoDownload } from "../../app/api/navy/video/download/route.ts";

test("Gemini video download route rejects untrusted media hosts before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null);
  };

  try {
    const response = await geminiVideoDownload(
      new Request("https://studio.test/api/gemini/video/download", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "secret",
        },
        body: JSON.stringify({
          uri: "https://attacker.example/v1beta/files/video",
        }),
      })
    );

    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini video download route sends key only to the trusted Gemini host", async () => {
  const originalFetch = globalThis.fetch;
  let receivedKey: string | null = null;
  globalThis.fetch = async (_url, init) => {
    receivedKey = new Headers(init?.headers).get("x-goog-api-key");
    return new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "video/mp4" },
    });
  };

  try {
    const response = await geminiVideoDownload(
      new Request("https://studio.test/api/gemini/video/download", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "gemini-secret",
        },
        body: JSON.stringify({
          uri: "https://generativelanguage.googleapis.com/v1beta/files/video",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(receivedKey, "gemini-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy video download route rejects untrusted media hosts before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null);
  };

  try {
    const response = await navyVideoDownload(
      new Request("https://studio.test/api/navy/video/download", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          url: "https://attacker.example/video.mp4",
        }),
      })
    );

    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy video download route sends bearer only to Navy hosts", async () => {
  const originalFetch = globalThis.fetch;
  let authorization: string | null = null;
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "video/mp4" },
    });
  };

  try {
    const response = await navyVideoDownload(
      new Request("https://studio.test/api/navy/video/download", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          url: "https://api.navy/v1/images/generations/file.mp4",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer navy-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route downloads generated CDN URLs server-side", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });

    if (url === "https://api.navy/v1/images/generations") {
      return Response.json({
        data: [
          { url: "https://s3.api.navy/generated.png" },
          { url: "https://replicate.delivery/xezq/generated.jpg" },
        ],
      });
    }

    if (url === "https://s3.api.navy/generated.png") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png", "content-length": "3" },
      });
    }

    if (url === "https://replicate.delivery/xezq/generated.jpg") {
      return new Response(new Uint8Array([4, 5]), {
        headers: { "content-type": "image/jpeg", "content-length": "2" },
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "flux",
          prompt: "Generate an image.",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.images, [
      { data: "AQID", mimeType: "image/png" },
      { data: "BAU=", mimeType: "image/jpeg" },
    ]);
    assert.equal(calls[0]?.authorization, "Bearer navy-secret");
    assert.equal(calls[1]?.authorization, null);
    assert.equal(calls[2]?.authorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route rejects untrusted generated image hosts before fetch", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);

    if (url === "https://api.navy/v1/images/generations") {
      return Response.json({
        data: [{ url: "https://attacker.example/generated.png" }],
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "flux",
          prompt: "Generate an image.",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error, "Unable to download generated image.");
    assert.deepEqual(calls, ["https://api.navy/v1/images/generations"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
