import test from "node:test";
import assert from "node:assert/strict";

import {
  ImageSubmissionError,
  isRetryableImageSubmissionError,
  submitImageRequest,
  waitForImageSubmissionRetry,
} from "./image-submission.ts";

test("cancelling while reading an image response preserves AbortError", async (t) => {
  const controller = new AbortController();
  const response = new Response("{}");
  t.mock.method(response, "json", async () => {
    controller.abort();
    throw new DOMException("Cancelled", "AbortError");
  });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(submitImageRequest("/api/multillm/image", {
    signal: controller.signal,
  }), { name: "AbortError" });
});

for (const status of [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]) {
  test(`image submission HTTP ${status} is retryable`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("Upstream unavailable", { status }));
    await assert.rejects(submitImageRequest("/api/multillm/image", {}), (error) => {
      assert.equal(isRetryableImageSubmissionError(error), true);
      assert.match((error as Error).message, new RegExp(`HTTP ${status}`));
      return true;
    });
  });
}

for (const code of ["insufficient_balance", "insufficient_quota", "invalid_api_key", "subscription_required", "content_policy_violation"]) {
  test(`${code} is terminal even when wrapped in HTTP 429 or 500`, () => {
    for (const status of [429, 500]) {
      const error = new ImageSubmissionError(new Response(null, { status }), {
        error: "Request failed",
        code,
        retryAfterMs: 1_000,
      });
      assert.equal(isRetryableImageSubmissionError(error), false);
    }
  });
}

test("non-submission errors cannot trigger another paid image request", () => {
  for (const error of [
    new Error("Image download failed [HTTP 524]"),
    new TypeError("Failed to fetch"),
    new DOMException("Aborted", "AbortError"),
  ]) {
    assert.equal(isRetryableImageSubmissionError(error), false);
  }
});

test("retry delays back off exponentially and honor Retry-After", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const cases = [
    { attempt: 1, headers: {}, payload: {}, expected: 1_000 },
    { attempt: 2, headers: {}, payload: {}, expected: 2_000 },
    { attempt: 8, headers: {}, payload: {}, expected: 30_000 },
    { attempt: 1, headers: { "retry-after": "7" }, payload: { retryAfterMs: 2_000 }, expected: 7_000 },
    { attempt: 1, headers: {}, payload: { retryAfterMs: 4_000 }, expected: 4_000 },
    { attempt: 1, headers: { "retry-after": "invalid" }, payload: { error: { retry_after_ms: 6_000 } }, expected: 6_000 },
  ];
  for (const { attempt, headers, payload, expected } of cases) {
    const error = new ImageSubmissionError(new Response(null, {
      status: 429,
      headers: headers as HeadersInit,
    }), payload);
    let done = false;
    const delay = waitForImageSubmissionRetry(error, attempt).then(() => { done = true; });
    t.mock.timers.tick(expected - 1);
    await Promise.resolve();
    assert.equal(done, false);
    t.mock.timers.tick(1);
    await delay;
    assert.equal(done, true);
  }
});

test("Retry-After dates are honored and excessive delays stop automatic retries", () => {
  const date = new Date(Date.now() + 20_000).toUTCString();
  const error = new ImageSubmissionError(new Response(null, {
    status: 503, headers: { "retry-after": date },
  }), {});
  assert.ok(error.retryAfterMs! >= 19_000 && error.retryAfterMs! <= 20_000);
  assert.equal(isRetryableImageSubmissionError(error), true);
  assert.equal(isRetryableImageSubmissionError(new ImageSubmissionError(
    new Response(null, { status: 429, headers: { "retry-after": "120" } }), {},
  )), false);
});

test("a successful response with unusable data is not a retryable submission error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("invalid JSON"));
  assert.deepEqual(await submitImageRequest("/api/multillm/image", {}), {});
});
