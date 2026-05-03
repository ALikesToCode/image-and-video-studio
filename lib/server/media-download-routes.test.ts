import test from "node:test";
import assert from "node:assert/strict";

import { POST as geminiVideoDownload } from "../../app/api/gemini/video/download/route.ts";
import {
  GET as navyImageGet,
  POST as navyImagePost,
} from "../../app/api/navy/image/route.ts";
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

test("Navy video download route downloads Replicate-hosted videos without bearer", async () => {
  const originalFetch = globalThis.fetch;
  let authorization: string | null = null;
  let fetchedUrl = "";
  globalThis.fetch = async (input, init) => {
    fetchedUrl = input instanceof Request ? input.url : String(input);
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(new Uint8Array([3, 4]), {
      headers: { "content-type": "video/mp4", "content-length": "2" },
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
          url: "https://replicate.delivery/xezq/generated.mp4",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(fetchedUrl, "https://replicate.delivery/xezq/generated.mp4");
    assert.equal(authorization, null);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal((await response.arrayBuffer()).byteLength, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route downloads generated CDN URLs server-side", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  let navyRequestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });

    if (url === "https://api.navy/v1/images/generations") {
      navyRequestBody =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null;
      return Response.json({
        data: [
          { url: "https://s3.api.navy/generated.png" },
          { url: "https://replicate.delivery/xezq/generated.jpg" },
          { url: "https://api.together.ai/shrt/generated.jpeg" },
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

    if (url === "https://api.together.ai/shrt/generated.jpeg") {
      return new Response(new Uint8Array([6, 7, 8, 9]), {
        headers: { "content-type": "image/jpeg", "content-length": "4" },
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
      { data: "BgcICQ==", mimeType: "image/jpeg" },
    ]);
    assert.equal(calls[0]?.authorization, "Bearer navy-secret");
    assert.equal(calls[1]?.authorization, null);
    assert.equal(calls[2]?.authorization, null);
    assert.equal(calls[3]?.authorization, null);
    const capturedBody = navyRequestBody as Record<string, unknown> | null;
    assert.equal(capturedBody?.sync, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route returns async job ids without waiting for media", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    return Response.json({ id: "job_123", status: "queued" });
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
          sync: true,
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { id: "job_123", status: "queued" });
    const capturedBody = requestBody as Record<string, unknown> | null;
    assert.equal(capturedBody?.sync, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route forwards multi-reference image URLs", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    return Response.json({ id: "job_refs", status: "queued" });
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
          model: "nano-banana-2",
          prompt: "Combine references.",
          imageUrl: [
            "data:image/png;base64,one",
            "data:image/png;base64,two",
            "data:image/png;base64,three",
            "data:image/png;base64,four",
            "data:image/png;base64,five",
            "data:image/png;base64,six",
          ],
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { id: "job_refs", status: "queued" });
    const capturedBody = requestBody as Record<string, unknown> | null;
    assert.deepEqual(capturedBody?.image_url, [
      "data:image/png;base64,one",
      "data:image/png;base64,two",
      "data:image/png;base64,three",
      "data:image/png;base64,four",
      "data:image/png;base64,five",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route retries flagged OpenAI image prompts with safer wording", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    if (typeof requestBody.prompt === "string") {
      prompts.push(requestBody.prompt);
    }
    if (prompts.length === 1) {
      return Response.json(
        { error: { message: "blocked by image safety policy" } },
        { status: 400 }
      );
    }
    return Response.json({ id: "job_safe", status: "queued" });
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
          model: "gpt-image-1.5",
          prompt: "Create a provocative nightclub editorial portrait.",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { id: "job_safe", status: "queued" });
    assert.equal(prompts.length, 2);
    assert.match(
      prompts[0] ?? "",
      /Create a provocative nightclub editorial portrait\./
    );
    assert.doesNotMatch(prompts[0] ?? "", /Safety recovery/i);
    assert.match(prompts[1] ?? "", /policy-compliant OpenAI image prompt/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route uses a prompt agent before strict-filter image models", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let imagePrompt = "";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (url === "https://api.navy/v1/chat/completions") {
      assert.equal(requestBody.model, "deepseek-v4-pro");
      assert.equal(requestBody.stream, false);
      return Response.json({
        choices: [
          {
            message: {
              content:
                "Agent fixed prompt: tasteful editorial anime portrait in a tidy bedroom, athletic curvy figure, expressive nervous mood, refined lighting.",
            },
          },
        ],
      });
    }

    if (url === "https://api.navy/v1/images/generations") {
      imagePrompt = String(requestBody.prompt ?? "");
      return Response.json({ id: "job_agent", status: "queued" });
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
          model: "gpt-image-2",
          promptAgentModel: "deepseek-v4-pro",
          prompt:
            "Create an anime portrait with a very large bust and hard nipples faintly outlined.",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { id: "job_agent", status: "queued" });
    assert.deepEqual(calls, [
      "https://api.navy/v1/chat/completions",
      "https://api.navy/v1/images/generations",
    ]);
    assert.match(imagePrompt, /Agent fixed prompt/i);
    assert.doesNotMatch(imagePrompt, /very large bust|hard nipples/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route treats poll rate limits as pending jobs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Too many requests" } },
      {
        status: 429,
        headers: { "retry-after": "7" },
      }
    );

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_rate_limited", {
        headers: {
          "x-user-api-key": "navy-secret",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      done: false,
      status: "rate_limited",
      retryAfterMs: 7000,
    });
    assert.equal(response.headers.get("retry-after"), "7");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route returns upstream failed job messages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "job_failed",
      status: "failed",
      error: {
        code: "job_failed",
        message: "No image data received, did the output get flagged as NSFW?",
      },
    });

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_failed", {
        headers: {
          "x-user-api-key": "navy-secret",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(
      payload.error,
      "No image data received, did the output get flagged as NSFW?"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route accepts data URL result URLs from async jobs", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      id: "job_data_url",
      status: "completed",
      result: {
        data: [{ url: "data:image/png;base64,AQID" }],
      },
    });
  };

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_data_url", {
        headers: {
          "x-user-api-key": "navy-secret",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      done: true,
      images: [{ data: "AQID", mimeType: "image/png" }],
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route accepts direct result URLs from async jobs", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url === "https://api.navy/v1/images/generations/job_direct_url") {
      return Response.json({
        id: "job_direct_url",
        status: "completed",
        result: {
          url: "data:image/png;base64,BAU=",
        },
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_direct_url", {
        headers: {
          "x-user-api-key": "navy-secret",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      done: true,
      images: [{ data: "BAU=", mimeType: "image/png" }],
    });
    assert.deepEqual(calls, [
      "https://api.navy/v1/images/generations/job_direct_url",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route explains when async job returns video media", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://api.navy/v1/images/generations/job_video_url") {
      return Response.json({
        id: "job_video_url",
        status: "completed",
        result: {
          data: [{ url: "https://replicate.delivery/xezq/generated.mp4" }],
        },
      });
    }

    if (url === "https://replicate.delivery/xezq/generated.mp4") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "video/mp4" },
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_video_url", {
        headers: {
          "x-user-api-key": "navy-secret",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(
      payload.error,
      "NavyAI returned a video file for this image request. Switch to Video mode or choose an image-capable NavyAI model."
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route downloads generated images from provider blob storage", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url === "https://api.navy/v1/images/generations/job_blob_url") {
      return Response.json({
        id: "job_blob_url",
        status: "completed",
        result: {
          data: [
            {
              url: "https://oaidalleapiprodscus.blob.core.windows.net/private/generated.png",
            },
          ],
        },
      });
    }

    if (url === "https://oaidalleapiprodscus.blob.core.windows.net/private/generated.png") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImageGet(
      new Request("https://studio.test/api/navy/image?id=job_blob_url", {
        headers: {
          "x-user-api-key": "navy-secret",
        },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      done: true,
      images: [{ data: "AQID", mimeType: "image/png" }],
    });
    assert.deepEqual(calls, [
      "https://api.navy/v1/images/generations/job_blob_url",
      "https://oaidalleapiprodscus.blob.core.windows.net/private/generated.png",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route returns immediate failed job messages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "job_failed",
      status: "failed",
      error: {
        code: "job_failed",
        message: "aspect_ratio must be one of the supported values",
      },
    });

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
    assert.equal(payload.error, "aspect_ratio must be one of the supported values");
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
