import test from "node:test";
import assert from "node:assert/strict";

import { GET as nanoGptAccountGet } from "../../app/api/nanogpt/account/route.ts";

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

const temporarilyUnsetEnv = (keys: string[]) => {
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  return () => {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

const accountRequest = (query = "") =>
  new Request(`https://studio.test/api/nanogpt/account${query}`, {
    headers: { "x-user-api-key": "nano-secret" },
  });

const usagePayload = {
  object: "usage",
  scope: "current_key",
  apiKey: { id: 123, privateLabel: "do-not-return" },
  from: "2026-06-01",
  to: "2026-06-30",
  timezone: "UTC",
  groupBy: "day,model",
  asOf: "2026-06-30T12:00:00.000Z",
  source: {
    rollupDays: ["2026-06-01"],
    liveDays: ["2026-06-30"],
    missingRollupDays: [],
  },
  totals: {
    requests: 12,
    costUsd: 1.5,
    refundedUsd: 0.1,
    netCostUsd: 1.4,
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 5,
    totalTokens: 150,
    internalProviderSpend: 99,
  },
  byDay: [
    {
      date: "2026-06-01",
      requests: 2,
      costUsd: 0.2,
      refundedUsd: 0,
      netCostUsd: 0.2,
      inputTokens: 20,
      outputTokens: 10,
      reasoningTokens: 0,
      totalTokens: 30,
    },
  ],
  byModel: [
    {
      model: "GPT Image",
      requests: 10,
      costUsd: 1.3,
      refundedUsd: 0.1,
      netCostUsd: 1.2,
      inputTokens: 80,
      outputTokens: 40,
      reasoningTokens: 5,
      totalTokens: 120,
      provider: "must-not-return",
    },
  ],
  byDayModel: [],
};

const balancePayload = {
  usd_balance: "129.46956147",
  nano_balance: "26.71801147",
  nanoDepositAddress: "nano_1accountdeposit",
  internalAccountId: "must-not-return",
};

const subscriptionPayload = {
  active: true,
  limits: { daily: 5000, monthly: 60000, internal: 1 },
  enforceDailyLimit: true,
  daily: {
    used: 5,
    remaining: 4995,
    percentUsed: 0.001,
    resetAt: 1782864000000,
  },
  monthly: {
    used: 45,
    remaining: 59955,
    percentUsed: 0.00075,
    resetAt: 1785542400000,
  },
  period: { currentPeriodEnd: "2026-07-31T23:59:59.000Z" },
  state: "active",
  graceUntil: null,
  customerId: "must-not-return",
};

test("NanoGPT account route uses documented endpoints and returns allowlisted account data", async () => {
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  const seenUrls = new Set<string>();

  try {
    await withFetch(
      async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const headers = new Headers(init?.headers);
        seenUrls.add(url);

        if (url === "https://nano-gpt.com/api/v1/usage?from=2026-06-01&to=2026-06-30&group_by=day%2Cmodel") {
          assert.equal(init?.method ?? "GET", "GET");
          assert.equal(headers.get("authorization"), "Bearer nano-secret");
          assert.equal(headers.get("x-api-key"), null);
          return Response.json(usagePayload);
        }
        if (url === "https://nano-gpt.com/api/check-balance") {
          assert.equal(init?.method, "POST");
          assert.equal(headers.get("x-api-key"), "nano-secret");
          assert.equal(headers.get("authorization"), null);
          assert.equal(init?.body ?? null, null);
          return Response.json(balancePayload);
        }
        if (url === "https://nano-gpt.com/api/subscription/v1/usage") {
          assert.equal(init?.method ?? "GET", "GET");
          assert.equal(headers.get("authorization"), "Bearer nano-secret");
          assert.equal(headers.get("x-api-key"), null);
          return Response.json(subscriptionPayload);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      async () => {
        const response = await nanoGptAccountGet(
          accountRequest("?from=2026-06-01&to=2026-06-30&group_by=day%2Cmodel"),
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store, max-age=0",
        );
        assert.equal(response.headers.get("pragma"), "no-cache");
        assert.deepEqual(seenUrls, new Set([
          "https://nano-gpt.com/api/v1/usage?from=2026-06-01&to=2026-06-30&group_by=day%2Cmodel",
          "https://nano-gpt.com/api/check-balance",
          "https://nano-gpt.com/api/subscription/v1/usage",
        ]));
        assert.deepEqual(payload, {
          balance: {
            usdBalance: "129.46956147",
            nanoBalance: "26.71801147",
            depositAddress: "nano_1accountdeposit",
          },
          usage: {
            from: "2026-06-01",
            to: "2026-06-30",
            timezone: "UTC",
            groupBy: "day,model",
            asOf: "2026-06-30T12:00:00.000Z",
            totals: {
              requests: 12,
              costUsd: 1.5,
              refundedUsd: 0.1,
              netCostUsd: 1.4,
              inputTokens: 100,
              outputTokens: 50,
              reasoningTokens: 5,
              totalTokens: 150,
            },
            byDay: [
              {
                date: "2026-06-01",
                requests: 2,
                costUsd: 0.2,
                refundedUsd: 0,
                netCostUsd: 0.2,
                inputTokens: 20,
                outputTokens: 10,
                reasoningTokens: 0,
                totalTokens: 30,
              },
            ],
            byModel: [
              {
                model: "GPT Image",
                requests: 10,
                costUsd: 1.3,
                refundedUsd: 0.1,
                netCostUsd: 1.2,
                inputTokens: 80,
                outputTokens: 40,
                reasoningTokens: 5,
                totalTokens: 120,
              },
            ],
            byDayModel: [],
          },
          subscription: {
            active: true,
            state: "active",
            enforceDailyLimit: true,
            limits: { daily: 5000, monthly: 60000 },
            daily: {
              used: 5,
              remaining: 4995,
              percentUsed: 0.001,
              resetAt: 1782864000000,
            },
            monthly: {
              used: 45,
              remaining: 59955,
              percentUsed: 0.00075,
              resetAt: 1785542400000,
            },
            currentPeriodEnd: "2026-07-31T23:59:59.000Z",
            graceUntil: null,
          },
        });
        assert.equal(JSON.stringify(payload).includes("nano-secret"), false);
        assert.equal(JSON.stringify(payload).includes("must-not-return"), false);
      },
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT account route validates documented usage filters before fetching", async () => {
  await withFetch(
    async () => {
      throw new Error("fetch must not run");
    },
    async () => {
      const missingTo = await nanoGptAccountGet(accountRequest("?from=2026-06-01"));
      assert.equal(missingTo.status, 400);

      const invalidGrouping = await nanoGptAccountGet(
        accountRequest("?group_by=provider"),
      );
      assert.equal(invalidGrouping.status, 400);

      const unsupported = await nanoGptAccountGet(
        accountRequest("?api_key_id=999"),
      );
      assert.equal(unsupported.status, 400);
      assert.deepEqual(await unsupported.json(), {
        error: "Unsupported NanoGPT account query parameter.",
      });
    },
  );
});

test("NanoGPT account route requires an API key before fetching", async () => {
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () => {
        throw new Error("fetch must not run");
      },
      async () => {
        const response = await nanoGptAccountGet(
          new Request("https://studio.test/api/nanogpt/account"),
        );
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: "NanoGPT API key is required.",
        });
        assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
      },
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT account route redacts core upstream errors", async () => {
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/api/v1/usage")) {
          return Response.json(
            {
              error: {
                message: "Bearer nano-secret is invalid",
                type: "invalid_api_key",
                internal: { authorization: "Bearer nano-secret" },
              },
            },
            { status: 401 },
          );
        }
        if (url.endsWith("/api/check-balance")) return Response.json(balancePayload);
        return Response.json(subscriptionPayload);
      },
      async () => {
        const response = await nanoGptAccountGet(accountRequest());
        const payload = await response.json();

        assert.equal(response.status, 401);
        assert.deepEqual(payload, {
          error: "Bearer [redacted] is invalid",
          code: "invalid_api_key",
          section: "usage",
        });
        assert.equal(JSON.stringify(payload).includes("nano-secret"), false);
      },
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT account route keeps optional subscription failures non-fatal", async () => {
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/api/v1/usage")) return Response.json(usagePayload);
        if (url.endsWith("/api/check-balance")) return Response.json(balancePayload);
        return Response.json(
          { error: { message: "Subscription is not active", type: "inactive_subscription" } },
          { status: 403 },
        );
      },
      async () => {
        const response = await nanoGptAccountGet(accountRequest());
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.subscription, null);
        assert.deepEqual(payload.warnings, [
          {
            section: "subscription",
            status: 403,
            code: "inactive_subscription",
            error: "Subscription is not active",
          },
        ]);
      },
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT account route rejects malformed core responses", async () => {
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/api/v1/usage")) return Response.json({ totals: null });
        if (url.endsWith("/api/check-balance")) return Response.json(balancePayload);
        return Response.json(subscriptionPayload);
      },
      async () => {
        const response = await nanoGptAccountGet(accountRequest());
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          error: "NanoGPT returned an invalid usage response.",
          section: "usage",
        });
      },
    );
  } finally {
    restoreEnv();
  }
});
