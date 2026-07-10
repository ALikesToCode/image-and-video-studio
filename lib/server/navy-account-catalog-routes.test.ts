import test from "node:test";
import assert from "node:assert/strict";

import { GET as navyModelsGet } from "../../app/api/navy/models/route.ts";
import { GET as navyUsageGet } from "../../app/api/navy/usage/route.ts";

const withFetch = async (
  handler: typeof globalThis.fetch,
  run: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("Navy models route preserves safe catalog error metadata", async () => {
  await withFetch(
    async () =>
      Response.json(
        {
          error: {
            message: "Catalog is temporarily unavailable",
            code: "catalog_unavailable",
            param: "endpoint",
            hint: "Retry after maintenance.",
          },
        },
        {
          status: 503,
          headers: {
            "x-request-id": "req_navy_models_503",
            "retry-after": "8",
          },
        },
      ),
    async () => {
      const response = await navyModelsGet(
        new Request("https://studio.test/api/navy/models"),
      );

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Catalog is temporarily unavailable",
        code: "catalog_unavailable",
        parameter: "endpoint",
        requestId: "req_navy_models_503",
        retryAfterMs: 8_000,
        guidance: "Retry after maintenance.",
      });
    },
  );
});

test("Navy usage route redacts credentials from structured failures", async () => {
  await withFetch(
    async () =>
      Response.json(
        {
          error: {
            message: "Bearer navy-secret is not authorized",
            type: "authentication_error",
            parameter: "api_key",
            guidance: "Replace apiKey: navy-secret",
          },
        },
        {
          status: 401,
          headers: { "x-request-id": "req_navy_usage_401" },
        },
      ),
    async () => {
      const response = await navyUsageGet(
        new Request("https://studio.test/api/navy/usage", {
          headers: { "x-user-api-key": "navy-secret" },
        }),
      );
      const payload = await response.json();

      assert.equal(response.status, 401);
      assert.deepEqual(payload, {
        error: "Bearer [redacted] is not authorized",
        code: "authentication_error",
        parameter: "api_key",
        requestId: "req_navy_usage_401",
        guidance: "Replace apiKey: [redacted]",
      });
      assert.doesNotMatch(JSON.stringify(payload), /navy-secret/);
    },
  );
});
