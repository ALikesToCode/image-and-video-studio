import test from "node:test";
import assert from "node:assert/strict";

import { GET as multiLlmUsageGet } from "../../app/api/multillm/usage/route.ts";
import { normalizeNanoGptBalance } from "../multillm-usage.ts";

const ENV_KEYS = [
  "MULTILLM_API_KEY",
  "PROXY_BASE_URL",
  "MULTILLM_PROXY_BASE_URL",
] as const;

const withMultiLlmEnv = async (run: () => Promise<void>) => {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MULTILLM_API_KEY = "shared-server-secret";
  process.env.PROXY_BASE_URL = "https://proxy.test";
  delete process.env.MULTILLM_PROXY_BASE_URL;
  try {
    await run();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

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

const usageRequest = (apiKey = "browser-proxy-secret") =>
  new Request("https://studio.test/api/multillm/usage", {
    headers: apiKey ? { "x-user-api-key": apiKey } : undefined,
  });

const navyUsagePayload = {
  plan: "creator",
  limits: { tokens_per_day: 1_000_000, rpm: 60, internal: "drop" },
  usage: {
    tokens_used_today: 125_000,
    tokens_remaining_today: 875_000,
    percent_used: 12.5,
    resets_at_utc: "2026-08-30T00:00:00.000Z",
    resets_in_ms: 3_600_000,
    privateUsageId: "drop",
  },
  rate_limits: {
    per_minute: {
      limit: 60,
      used: 4,
      remaining: 56,
      resets_in_ms: 25_000,
      privateBucket: "drop",
    },
  },
  server_time_utc: "2026-08-29T18:00:00.000Z",
  privateAccountId: "drop",
};

const nanoUsagePayload = {
  object: "usage",
  scope: "current_key",
  apiKey: { id: 991, label: "drop" },
  from: "2026-08-01",
  to: "2026-08-29",
  timezone: "UTC",
  groupBy: "day,model",
  asOf: "2026-08-29T18:00:00.000Z",
  totals: {
    requests: 42,
    costUsd: 3.25,
    refundedUsd: 0.25,
    netCostUsd: 3,
    inputTokens: 2_000,
    outputTokens: 1_000,
    reasoningTokens: 200,
    totalTokens: 3_000,
    internalProviderSpend: 99,
  },
};

const nanoBalancePayload = {
  usd_balance: "20.5",
  usd_pending_usage: "0.25",
  usd_pending_usage_status: "estimated",
  usd_spendable_balance: "20.25",
  nano_balance: "12.75",
  nanoDepositAddress: "nano_private_address",
};

const nanoSubscriptionPayload = {
  active: true,
  provider: "stripe",
  providerStatus: "active",
  stripeSubscriptionId: "sub_private",
  limits: {
    weeklyInputTokens: 100_000,
    dailyInputTokens: 20_000,
    dailyImages: 50,
  },
  period: { currentPeriodEnd: "2026-09-01T00:00:00.000Z" },
  dailyImages: {
    used: 12,
    remaining: 38,
    percentUsed: 0.24,
    resetAt: 1_777_593_600_000,
  },
  weeklyInputTokens: {
    used: 25_000,
    remaining: 75_000,
    percentUsed: 25,
    resetAt: 1_778_112_000_000,
  },
  state: "active",
  routing: { internalPolicy: "drop" },
};

test("NanoGPT balance normalization accepts unavailable pending-balance fields", () => {
  assert.deepEqual(
    normalizeNanoGptBalance({
      usd_balance: "20.5",
      usd_pending_usage: null,
      usd_spendable_balance: null,
      nano_balance: "12.75",
    }),
    {
      usdBalance: "20.5",
      usdSpendableBalance: null,
      usdPendingUsage: null,
      nanoBalance: "12.75",
    },
  );
});

test("MultiLLM usage requires a browser key instead of exposing the shared server account", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async () => {
        throw new Error("fetch must not run");
      },
      async () => {
        const response = await multiLlmUsageGet(usageRequest(""));
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: "Add a browser-held MultiLLM API key to view private account usage.",
        });
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store, max-age=0",
        );
      },
    );
  });
});

test("MultiLLM usage aggregates and allowlists provider-reported account data", async () => {
  await withMultiLlmEnv(async () => {
    const seen = new Map<string, string>();
    await withFetch(
      async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer browser-proxy-secret");
        assert.equal(headers.get("accept"), "application/json");
        seen.set(url, init?.method ?? "GET");

        if (url === "https://proxy.test/navyai/v1/usage") {
          return Response.json(navyUsagePayload);
        }
        if (url === "https://proxy.test/nanogpt/v1/usage") {
          return Response.json(nanoUsagePayload);
        }
        if (url === "https://proxy.test/nanogpt/check-balance") {
          return Response.json(nanoBalancePayload);
        }
        if (url === "https://proxy.test/nanogpt/subscription/v1/usage") {
          return Response.json(nanoSubscriptionPayload);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      async () => {
        const response = await multiLlmUsageGet(usageRequest());
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("pragma"), "no-cache");
        assert.deepEqual(seen, new Map([
          ["https://proxy.test/navyai/v1/usage", "GET"],
          ["https://proxy.test/nanogpt/v1/usage", "GET"],
          ["https://proxy.test/nanogpt/check-balance", "POST"],
          ["https://proxy.test/nanogpt/subscription/v1/usage", "GET"],
        ]));
        assert.equal(payload.operationsUrl, "https://proxy.test/");
        assert.equal(payload.navyai.status, "available");
        assert.deepEqual(payload.navyai.data, {
          plan: "creator",
          limits: { tokens_per_day: 1_000_000, rpm: 60 },
          usage: {
            tokens_used_today: 125_000,
            tokens_remaining_today: 875_000,
            percent_used: 12.5,
            resets_at_utc: "2026-08-30T00:00:00.000Z",
            resets_in_ms: 3_600_000,
          },
          rate_limits: {
            per_minute: {
              limit: 60,
              used: 4,
              remaining: 56,
              resets_in_ms: 25_000,
            },
          },
          server_time_utc: "2026-08-29T18:00:00.000Z",
        });
        assert.equal(payload.nanogpt.status, "available");
        assert.deepEqual(payload.nanogpt.balance.data, {
          usdBalance: "20.5",
          usdSpendableBalance: "20.25",
          usdPendingUsage: "0.25",
          nanoBalance: "12.75",
        });
        assert.deepEqual(payload.nanogpt.usage.data, {
          from: "2026-08-01",
          to: "2026-08-29",
          asOf: "2026-08-29T18:00:00.000Z",
          totals: {
            requests: 42,
            costUsd: 3.25,
            refundedUsd: 0.25,
            netCostUsd: 3,
            inputTokens: 2_000,
            outputTokens: 1_000,
            reasoningTokens: 200,
            totalTokens: 3_000,
          },
        });
        assert.deepEqual(payload.nanogpt.subscription.data, {
          active: true,
          state: "active",
          provider: "stripe",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          quotas: [
            {
              id: "dailyImages",
              label: "Daily images",
              unit: "images",
              used: 12,
              remaining: 38,
              percentUsed: 0.24,
              resetAt: 1_777_593_600_000,
            },
            {
              id: "weeklyInputTokens",
              label: "Weekly input",
              unit: "tokens",
              used: 25_000,
              remaining: 75_000,
              percentUsed: 0.25,
              resetAt: 1_778_112_000_000,
            },
          ],
        });
        const serialized = JSON.stringify(payload);
        assert.doesNotMatch(serialized, /browser-proxy-secret|shared-server-secret/);
        assert.doesNotMatch(
          serialized,
          /privateAccountId|privateUsageId|privateBucket|apiKey|nanoDepositAddress|stripeSubscriptionId|routing|internalProviderSpend/,
        );
      },
    );
  });
});

test("MultiLLM usage keeps healthy provider sections when other checks fail", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async (input) => {
        const url = String(input);
        if (url.endsWith("/navyai/v1/usage")) {
          return Response.json(
            {
              error: {
                message: "Bearer browser-proxy-secret cannot access NavyAI usage",
                type: "plan_required",
              },
            },
            { status: 403, headers: { "x-request-id": "req_navy_403" } },
          );
        }
        if (url.endsWith("/nanogpt/v1/usage")) {
          return Response.json(nanoUsagePayload);
        }
        if (url.endsWith("/nanogpt/check-balance")) {
          return Response.json(nanoBalancePayload);
        }
        return Response.json(
          { error: { message: "Subscription service is unavailable" } },
          { status: 503 },
        );
      },
      async () => {
        const response = await multiLlmUsageGet(usageRequest());
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload.navyai, {
          status: "unavailable",
          error: "Bearer [redacted] cannot access NavyAI usage",
          statusCode: 403,
          code: "plan_required",
          requestId: "req_navy_403",
        });
        assert.equal(payload.nanogpt.status, "partial");
        assert.equal(payload.nanogpt.usage.status, "available");
        assert.equal(payload.nanogpt.balance.status, "available");
        assert.deepEqual(payload.nanogpt.subscription, {
          status: "unavailable",
          error: "Subscription service is unavailable",
          statusCode: 503,
        });
        assert.doesNotMatch(JSON.stringify(payload), /browser-proxy-secret/);
      },
    );
  });
});

test("MultiLLM usage rejects malformed successful sections without hiding valid ones", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async (input) => {
        const url = String(input);
        if (url.endsWith("/navyai/v1/usage")) return Response.json({ plan: "missing fields" });
        if (url.endsWith("/nanogpt/v1/usage")) return Response.json(nanoUsagePayload);
        if (url.endsWith("/nanogpt/check-balance")) return Response.json(nanoBalancePayload);
        return Response.json(nanoSubscriptionPayload);
      },
      async () => {
        const response = await multiLlmUsageGet(usageRequest());
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload.navyai, {
          status: "unavailable",
          error: "NavyAI returned an invalid usage response.",
        });
        assert.equal(payload.nanogpt.status, "available");
      },
    );
  });
});
