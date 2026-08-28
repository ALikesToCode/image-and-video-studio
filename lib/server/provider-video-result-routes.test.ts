import test from "node:test";
import assert from "node:assert/strict";

import { GET as geminiVideoGet } from "../../app/api/gemini/video/route.ts";
import { GET as navyVideoGet } from "../../app/api/navy/video/route.ts";

test("Gemini video route rejects unsafe provider result URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [{ video: { uri: "file:///tmp/result.mp4" } }],
        },
      },
    });

  try {
    const response = await geminiVideoGet(
      new Request("https://studio.test/api/gemini/video?name=operations/job-safe", {
        headers: { "x-user-api-key": "gemini-secret" },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error, "Video URL not found in response.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini video route redacts credentials from completed job errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      done: true,
      error: { message: "Provider rejected key gemini-secret" },
    });

  try {
    const response = await geminiVideoGet(
      new Request("https://studio.test/api/gemini/video?name=operations/job-safe", {
        headers: { "x-user-api-key": "gemini-secret" },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error.includes("gemini-secret"), false);
    assert.match(payload.error, /\[redacted\]/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy video route rejects unsafe provider result URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "job_unsafe_url",
      status: "completed",
      result: { data: [{ url: "javascript:alert(1)" }] },
    });

  try {
    const response = await navyVideoGet(
      new Request("https://studio.test/api/navy/video?id=job_unsafe_url", {
        headers: { "x-user-api-key": "navy-secret" },
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error, "Video URL not found in response.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
