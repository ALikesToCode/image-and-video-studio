import test from "node:test";
import assert from "node:assert/strict";

import {
  getProviderApiKey,
  getUserApiKey,
  providerErrorMessage,
  redactSecrets,
} from "./api-safety.ts";

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

test("getUserApiKey accepts Authorization bearer keys for userscripts", () => {
  const request = new Request("https://studio.test/api/chutes/image", {
    headers: { authorization: "Bearer user-secret" },
  });

  assert.equal(getUserApiKey(request), "user-secret");
});

test("getProviderApiKey prefers server env keys over BYOK request keys", () => {
  const original = process.env.CHUTES_API_KEY;
  process.env.CHUTES_API_KEY = "server-secret";
  const request = new Request("https://studio.test/api/chutes/image", {
    headers: {
      authorization: "Bearer user-secret",
      "x-user-api-key": "header-secret",
    },
  });

  try {
    assert.equal(getProviderApiKey("chutes", request), "server-secret");
  } finally {
    if (original === undefined) {
      delete process.env.CHUTES_API_KEY;
    } else {
      process.env.CHUTES_API_KEY = original;
    }
  }
});

test("getProviderApiKey accepts the local NAVY_API server env alias", () => {
  const originals = {
    NAVY_API_KEY: process.env.NAVY_API_KEY,
    NAVYAI_API_KEY: process.env.NAVYAI_API_KEY,
    NAVY_API: process.env.NAVY_API,
  };
  delete process.env.NAVY_API_KEY;
  delete process.env.NAVYAI_API_KEY;
  process.env.NAVY_API = "server-navy-secret";
  const request = new Request("https://studio.test/api/navy/image", {
    headers: { "x-user-api-key": "user-secret" },
  });

  try {
    assert.equal(getProviderApiKey("navy", request), "server-navy-secret");
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
