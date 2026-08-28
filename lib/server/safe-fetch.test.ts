import test from "node:test";
import assert from "node:assert/strict";

import {
  safeFetchExternalMedia,
  validateExternalMediaUrl,
} from "./safe-fetch.ts";

const allowedHosts = ["media.example.com"];

test("validateExternalMediaUrl rejects unsafe URL shapes", () => {
  assert.throws(() => validateExternalMediaUrl("not a url", allowedHosts), /Invalid/);
  assert.throws(
    () => validateExternalMediaUrl("http://media.example.com/file.png", allowedHosts),
    /HTTPS/
  );
  assert.throws(
    () => validateExternalMediaUrl("file:///tmp/file.png", allowedHosts),
    /HTTPS/
  );
  assert.throws(
    () => validateExternalMediaUrl("https://localhost/file.png", allowedHosts),
    /Local/
  );
  assert.throws(
    () => validateExternalMediaUrl("https://127.0.0.1/file.png", allowedHosts),
    /Local/
  );
  assert.throws(
    () =>
      validateExternalMediaUrl(
        "https://[::ffff:127.0.0.1]/file.png",
        ["[::ffff:7f00:1]"]
      ),
    /Local/
  );
  assert.throws(
    () => validateExternalMediaUrl("https://[::]/file.png", ["[::]"]),
    /Local/
  );
  assert.throws(
    () => validateExternalMediaUrl("https://[fe90::1]/file.png", ["[fe90::1]"]),
    /Local/
  );
  assert.throws(
    () => validateExternalMediaUrl("https://attacker.example/file.png", allowedHosts),
    /host/
  );
});

test("safeFetchExternalMedia accepts allowed host and content type", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png", "content-length": "3" },
    });

  try {
    const response = await safeFetchExternalMedia(
      "https://media.example.com/image.png",
      {
        allowedHosts,
        allowedContentTypes: ["image/"],
        maxBytes: 10,
        timeoutMs: 1000,
      }
    );
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal((await response.arrayBuffer()).byteLength, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetchExternalMedia rejects wrong content type", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("html", {
      headers: { "content-type": "text/html" },
    });

  try {
    await assert.rejects(
      safeFetchExternalMedia("https://media.example.com/image.png", {
        allowedHosts,
        allowedContentTypes: ["image/"],
        maxBytes: 10,
        timeoutMs: 1000,
      }),
      /content type/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetchExternalMedia does not accept a content-type prefix spoof", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("not a png", {
      headers: { "content-type": "image/png-malformed" },
    });

  try {
    await assert.rejects(
      safeFetchExternalMedia("https://media.example.com/image.png", {
        allowedHosts,
        allowedContentTypes: ["image/png"],
        maxBytes: 100,
        timeoutMs: 1000,
      }),
      /content type/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetchExternalMedia rejects oversized bodies from content-length and stream", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Uint8Array([1]), {
      headers: { "content-type": "image/png", "content-length": "99" },
    });

  try {
    await assert.rejects(
      safeFetchExternalMedia("https://media.example.com/image.png", {
        allowedHosts,
        allowedContentTypes: ["image/"],
        maxBytes: 10,
        timeoutMs: 1000,
      }),
      /too large/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "content-type": "image/png" },
    });

  try {
    await assert.rejects(
      safeFetchExternalMedia("https://media.example.com/image.png", {
        allowedHosts,
        allowedContentTypes: ["image/"],
        maxBytes: 3,
        timeoutMs: 1000,
      }),
      /too large/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetchExternalMedia rejects redirect to an unallowed host", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/image.png" },
    });

  try {
    await assert.rejects(
      safeFetchExternalMedia("https://media.example.com/image.png", {
        allowedHosts,
        allowedContentTypes: ["image/"],
        maxBytes: 10,
        timeoutMs: 1000,
        allowRedirects: true,
      }),
      /host/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetchExternalMedia strips credentials on an allowed cross-origin redirect", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
    });
    if (requests.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/image.png" },
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });
  };

  try {
    await safeFetchExternalMedia("https://media.example.com/image.png", {
      allowedHosts: ["media.example.com", "cdn.example.com"],
      allowedContentTypes: ["image/"],
      maxBytes: 10,
      timeoutMs: 1000,
      allowRedirects: true,
      headers: {
        Accept: "image/*",
        Authorization: "Bearer provider-secret",
        Cookie: "session=provider-secret",
        "X-Api-Key": "provider-secret",
      },
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers.get("authorization"), "Bearer provider-secret");
    assert.equal(requests[1].url, "https://cdn.example.com/image.png");
    assert.equal(requests[1].headers.get("authorization"), null);
    assert.equal(requests[1].headers.get("cookie"), null);
    assert.equal(requests[1].headers.get("x-api-key"), null);
    assert.equal(requests[1].headers.get("accept"), "image/*");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetchExternalMedia applies its timeout while reading the body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new Error("stream aborted"));
          });
        },
      }),
      { headers: { "content-type": "video/mp4" } }
    );

  let guardTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(
      Promise.race([
        safeFetchExternalMedia("https://media.example.com/video.mp4", {
          allowedHosts,
          allowedContentTypes: ["video/"],
          maxBytes: 10,
          timeoutMs: 10,
        }),
        new Promise((_, reject) => {
          guardTimeout = setTimeout(
            () => reject(new Error("safe fetch did not enforce body timeout")),
            100
          );
        }),
      ]),
      /timed out/
    );
  } finally {
    if (guardTimeout) clearTimeout(guardTimeout);
    globalThis.fetch = originalFetch;
  }
});
