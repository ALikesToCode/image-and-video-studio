import test from "node:test";
import assert from "node:assert/strict";

import { providerErrorMessage, redactSecrets } from "./api-safety.ts";

test("redactSecrets removes explicit keys and bearer tokens", () => {
  const secret = "sk-test-secret";
  const redacted = redactSecrets(
    `request failed for Bearer ${secret} with apiKey: ${secret}`,
    [secret]
  );

  assert.doesNotMatch(redacted, /sk-test-secret/);
  assert.match(redacted, /\[redacted\]/);
});

test("providerErrorMessage extracts nested provider errors safely", () => {
  assert.equal(
    providerErrorMessage(
      { error: { message: "Invalid key abc123" } },
      "fallback",
      ["abc123"]
    ),
    "Invalid key [redacted]"
  );
  assert.equal(providerErrorMessage(null, "fallback"), "fallback");
});
