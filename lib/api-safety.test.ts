import test from "node:test";
import assert from "node:assert/strict";

import {
  getProviderApiKey,
  getUserApiKey,
  providerErrorDetails,
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

test("redactSecrets consumes common authorization schemes and encoded tokens", () => {
  const redacted = redactSecrets(
    [
      "Authorization: Basic dXNlcjpwYXNz",
      "Authorization: Token sk-upstream-secret",
      "access_token: abc%2Fdef",
      "password=hunter2",
    ].join("; "),
  );

  assert.doesNotMatch(
    redacted,
    /dXNlcjpwYXNz|sk-upstream-secret|abc%2Fdef|hunter2/,
  );
  assert.equal((redacted.match(/\[redacted\]/g) ?? []).length, 4);
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

test("providerErrorDetails preserves documented provider metadata safely", () => {
  const apiKey = "sk-nano-secret";
  const response = Response.json(null, {
    status: 429,
    headers: {
      "Retry-After": "7",
      "X-Request-ID": "req_header_456",
    },
  });

  assert.deepEqual(
    providerErrorDetails(
      {
        error: {
          message: `Invalid Bearer ${apiKey}`,
          code: "invalid_parameter_value",
          param: "resolution",
          request_id: "req_body_ignored",
          userFriendlyError: `Choose a supported resolution; apiKey: ${apiKey}`,
          retry_after_ms: 2_500,
        },
      },
      "fallback",
      { knownSecrets: [apiKey], response },
    ),
    {
      error: "Invalid Bearer [redacted]",
      code: "invalid_parameter_value",
      parameter: "resolution",
      requestId: "req_header_456",
      retryAfterMs: 7_000,
      guidance: "Choose a supported resolution; apiKey: [redacted]",
    },
  );
});

test("providerErrorDetails accepts root parameter and retry aliases", () => {
  assert.deepEqual(
    providerErrorDetails(
      {
        message: "The job expired.",
        code: "job_expired",
        parameter: "job_id",
        requestId: "req_body_123",
        retryAfter: 3,
        guidance: "Submit a new generation request.",
      },
      "fallback",
    ),
    {
      error: "The job expired.",
      code: "job_expired",
      parameter: "job_id",
      requestId: "req_body_123",
      retryAfterMs: 3_000,
      guidance: "Submit a new generation request.",
    },
  );
});

test("providerErrorDetails drops unsafe identifiers and redacts guidance", () => {
  const apiKey = "sk-navy-secret";
  const details = providerErrorDetails(
    {
      error: {
        message: `Authorization: Bearer ${apiKey}`,
        code: `invalid_${apiKey}`,
        parameter: `prompt\n${apiKey}`,
      },
      request_id: `req_${apiKey}`,
      hint: `Use x-api-key: ${apiKey}`,
    },
    "fallback",
    { knownSecrets: [apiKey] },
  );

  assert.deepEqual(details, {
    error: "Authorization: Bearer [redacted]",
    guidance: "Use x-api-key: [redacted]",
  });
  assert.doesNotMatch(JSON.stringify(details), /sk-navy-secret/);
});

test("providerErrorDetails skips invalid aliases before valid fallbacks", () => {
  const response = Response.json(null, {
    status: 400,
    headers: { "x-request-id": "invalid request id" },
  });

  assert.deepEqual(
    providerErrorDetails(
      {
        error: {
          message: "Invalid input",
          code: "invalid code",
          type: "invalid_request_error",
          param: "invalid parameter",
          parameter: "input[0].image_url",
        },
        requestId: "req_valid_body_123",
      },
      "fallback",
      { response },
    ),
    {
      error: "Invalid input",
      code: "invalid_request_error",
      parameter: "input[0].image_url",
      requestId: "req_valid_body_123",
    },
  );

  assert.deepEqual(
    providerErrorDetails(
      {
        error: {
          message: "Invalid input",
          param: "invalid parameter",
          parameter: "also invalid parameter",
        },
        param: "input[1].image_url",
      },
      "fallback",
    ),
    {
      error: "Invalid input",
      parameter: "input[1].image_url",
    },
  );
});

test("providerErrorDetails skips invalid retry aliases before valid fallbacks", () => {
  assert.equal(
    providerErrorDetails(
      {
        error: {
          message: "Try again later",
          retryAfterMs: "not-a-delay",
          retry_after_ms: 2_500,
        },
      },
      "fallback",
    ).retryAfterMs,
    2_500,
  );

  assert.equal(
    providerErrorDetails(
      {
        error: {
          message: "Try again later",
          retryAfter: "not-a-delay",
          retry_after: 4,
        },
      },
      "fallback",
    ).retryAfterMs,
    4_000,
  );

  assert.equal(
    providerErrorDetails(
      {
        error: {
          message: "Try again later",
          retry_after_ms: 2_500,
        },
      },
      "fallback",
      {
        response: Response.json(null, {
          status: 429,
          headers: { "retry-after": "-1" },
        }),
      },
    ).retryAfterMs,
    2_500,
  );
});

test("providerErrorDetails bounds provider-controlled messages", () => {
  const details = providerErrorDetails(
    { error: { message: "x".repeat(5_000) } },
    "fallback",
  );

  assert.equal(details.error.length, 1_000);
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
