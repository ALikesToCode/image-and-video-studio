import test from "node:test";
import assert from "node:assert/strict";

import { formatProviderErrorForDisplay } from "./provider-error.ts";

test("provider error display keeps safe diagnostic metadata", () => {
  assert.equal(
    formatProviderErrorForDisplay(
      {
        error: "An unexpected provider error occurred",
        code: "upstream_unavailable",
        parameter: "model",
        requestId: "req_navy_123",
        retryAfterMs: 4_500,
        guidance: "The Gemini image provider is temporarily unavailable.",
      },
      { fallback: "Image tool failed.", status: 502 },
    ),
    "An unexpected provider error occurred [HTTP 502; code upstream_unavailable; parameter model; request req_navy_123] Detail: The Gemini image provider is temporarily unavailable. Retry after 5s.",
  );
});

test("provider error display reports HTTP status when the body is unavailable", () => {
  assert.equal(
    formatProviderErrorForDisplay(null, {
      fallback: "Image tool failed.",
      status: 503,
    }),
    "Image tool failed. [HTTP 503]",
  );
});

test("provider error display normalizes control characters and bounds output", () => {
  const message = formatProviderErrorForDisplay(
    {
      error: "Provider failed\nwith\tbad input",
      guidance: "x".repeat(5_000),
    },
    { fallback: "fallback", status: 400 },
  );

  assert.match(message, /^Provider failed with bad input \[HTTP 400\] Detail: x+/);
  assert.equal(message.length, 1_050);
});
