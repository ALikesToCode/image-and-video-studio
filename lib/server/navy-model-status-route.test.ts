import test from "node:test";
import assert from "node:assert/strict";

import { GET as navyModelStatusGet } from "../../app/api/navy/model-status/route.ts";

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

const upstreamStatusPayload = {
  lastUpdated: "2026-07-10T06:35:24.732Z",
  models: {
    "gpt-image-2": {
      endpoint: "/v1/images/generations",
      lastChecked: "2026-07-10T01:30:54.372Z",
      lastStatus: "ok",
      inProgress: false,
      lastError: null,
      stats: {
        checksCount: 14,
        okCount: 12,
        uptimePercent: 85.7,
        avgTtft: null,
        avgTotal: 14315,
      },
      history: [
        {
          ts: "2026-07-10T01:30:54.372Z",
          status: "ok",
          total: 14315,
        },
      ],
    },
    "veo-3.1": {
      endpoint: "/v1/images/generations",
      lastChecked: "2026-07-10T01:31:54.372Z",
      lastStatus: "timeout",
      inProgress: true,
      lastError: "Upstream timed out",
      stats: {
        checksCount: 10,
        okCount: 8,
        uptimePercent: 80,
        avgTtft: null,
        avgTotal: 8200,
      },
      history: [{ ts: "2026-07-10T01:31:54.372Z", status: "timeout" }],
    },
    "gpt-5.4": {
      endpoint: "/v1/chat/completions",
      lastChecked: "2026-07-10T06:35:24.732Z",
      lastStatus: "ok",
      inProgress: false,
      lastError: null,
      stats: {
        checksCount: 50,
        okCount: 50,
        uptimePercent: 100,
        avgTtft: 51,
        avgTotal: 72,
      },
      history: [{ ts: "2026-07-10T06:35:24.732Z", status: "ok" }],
    },
  },
};

test("Navy model status route returns compact media health without histories", async () => {
  await withFetch(
    async (input, init) => {
      assert.equal(
        input instanceof Request ? input.url : String(input),
        "https://api.navy/v1/models/status",
      );
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return Response.json(upstreamStatusPayload);
    },
    async () => {
      const response = await navyModelStatusGet(
        new Request("https://studio.test/api/navy/model-status"),
      );

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=60, stale-while-revalidate=300",
      );
      assert.deepEqual(await response.json(), {
        lastUpdated: "2026-07-10T06:35:24.732Z",
        models: {
          "gpt-image-2": {
            id: "gpt-image-2",
            endpoint: "/v1/images/generations",
            status: "ok",
            lastChecked: "2026-07-10T01:30:54.372Z",
            inProgress: false,
            uptimePercent: 85.7,
            checksCount: 14,
            okCount: 12,
            avgTtft: null,
            avgTotal: 14315,
          },
          "veo-3.1": {
            id: "veo-3.1",
            endpoint: "/v1/images/generations",
            status: "timeout",
            lastChecked: "2026-07-10T01:31:54.372Z",
            inProgress: true,
            uptimePercent: 80,
            checksCount: 10,
            okCount: 8,
            avgTtft: null,
            avgTotal: 8200,
            error: "Upstream timed out",
          },
        },
      });
    },
  );
});

test("Navy model status route returns only validated requested model IDs", async () => {
  await withFetch(
    async () => Response.json(upstreamStatusPayload),
    async () => {
      const response = await navyModelStatusGet(
        new Request(
          "https://studio.test/api/navy/model-status?ids=gpt-5.4,gpt-image-2,gpt-5.4,missing-model",
        ),
      );
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(payload.models), ["gpt-5.4", "gpt-image-2"]);
      assert.equal(payload.models["gpt-5.4"].endpoint, "/v1/chat/completions");
      assert.equal(payload.models["gpt-5.4"].uptimePercent, 100);
      assert.equal("history" in payload.models["gpt-5.4"], false);
    },
  );
});

test("Navy model status route rejects invalid IDs before fetching", async () => {
  await withFetch(
    async () => {
      throw new Error("fetch must not run");
    },
    async () => {
      const response = await navyModelStatusGet(
        new Request(
          "https://studio.test/api/navy/model-status?ids=gpt-image-2,../secret",
        ),
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "Navy model IDs must be a comma-separated list of valid IDs.",
      });
    },
  );
});

test("Navy model status route preserves safe upstream errors", async () => {
  await withFetch(
    async () =>
      Response.json(
        {
          error: {
            message: "Status temporarily unavailable",
            code: "status_unavailable",
            stack: "internal-only",
          },
          request: { authorization: "Bearer secret" },
        },
        { status: 503 },
      ),
    async () => {
      const response = await navyModelStatusGet(
        new Request("https://studio.test/api/navy/model-status"),
      );

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Status temporarily unavailable",
        code: "status_unavailable",
      });
    },
  );
});

test("Navy model status route handles malformed upstream JSON", async () => {
  await withFetch(
    async () => new Response("not-json", { status: 200 }),
    async () => {
      const response = await navyModelStatusGet(
        new Request("https://studio.test/api/navy/model-status"),
      );

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: "Unable to parse Navy model status response.",
      });
    },
  );
});
