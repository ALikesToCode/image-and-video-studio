import test from "node:test";
import assert from "node:assert/strict";

import { GET as nanoGptChatModelsGet } from "../../app/api/nanogpt/chat-models/route.ts";

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

const withoutNanoGptEnvironmentKey = async (run: () => Promise<void>) => {
  const previousPrimary = process.env.NANOGPT_API_KEY;
  const previousAlternative = process.env.NANO_GPT_API_KEY;
  delete process.env.NANOGPT_API_KEY;
  delete process.env.NANO_GPT_API_KEY;
  try {
    await run();
  } finally {
    if (previousPrimary === undefined) delete process.env.NANOGPT_API_KEY;
    else process.env.NANOGPT_API_KEY = previousPrimary;
    if (previousAlternative === undefined) delete process.env.NANO_GPT_API_KEY;
    else process.env.NANO_GPT_API_KEY = previousAlternative;
  }
};

test("NanoGPT chat catalog uses authenticated detailed favorites without shared caching", async () => {
  await withoutNanoGptEnvironmentKey(async () => {
    await withFetch(
      async (input, init) => {
        assert.equal(
          input instanceof Request ? input.url : String(input),
          "https://nano-gpt.com/api/v1/models?detailed=true&sort=favorites",
        );
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer nano-secret");
        assert.equal(headers.get("accept"), "application/json");
        return Response.json({
          object: "list",
          data: [
            {
              id: "openai/gpt-5.2",
              name: "GPT-5.2",
              capabilities: { tool_calling: true },
              pricing: {
                prompt: 2.5,
                completion: 10,
                currency: "USD",
                unit: "per_million_tokens",
              },
            },
          ],
          meta: { distillation: "all" },
        });
      },
      async () => {
        const response = await nanoGptChatModelsGet(
          new Request("https://studio.test/api/nanogpt/chat-models", {
            headers: { "x-user-api-key": "nano-secret" },
          }),
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(payload.authenticated, true);
        assert.equal(payload.sort, "favorites");
        assert.equal(payload.models[0].id, "openai/gpt-5.2");
        assert.equal(payload.models[0].supportsTools, true);
        assert.deepEqual(payload.models[0].pricing, {
          prompt: 2.5,
          completion: 10,
          currency: "USD",
          unit: "per_million_tokens",
        });
        assert.deepEqual(payload.meta, { distillation: "all" });
      },
    );
  });
});

test("NanoGPT chat catalog falls back to global most-used ordering without a key", async () => {
  await withoutNanoGptEnvironmentKey(async () => {
    await withFetch(
      async (input, init) => {
        assert.equal(
          input instanceof Request ? input.url : String(input),
          "https://nano-gpt.com/api/v1/models?detailed=true&sort=mostused",
        );
        assert.equal(new Headers(init?.headers).has("authorization"), false);
        return Response.json({ data: [{ id: "minimax/minimax-m2.7" }] });
      },
      async () => {
        const response = await nanoGptChatModelsGet(
          new Request("https://studio.test/api/nanogpt/chat-models"),
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("cache-control"),
          "public, max-age=300, stale-while-revalidate=3600",
        );
        assert.equal(payload.authenticated, false);
        assert.equal(payload.sort, "mostused");
        assert.equal(payload.models[0].id, "minimax/minimax-m2.7");
      },
    );
  });
});

test("NanoGPT chat catalog returns redacted structured upstream errors", async () => {
  await withoutNanoGptEnvironmentKey(async () => {
    await withFetch(
      async () =>
        Response.json(
          {
            error: {
              message: "Rejected Bearer nano-secret",
              code: "rate_limited",
              param: "sort",
              guidance: "Retry the catalog request later.",
            },
          },
          {
            status: 429,
            headers: {
              "retry-after": "4",
              "x-request-id": "req_nano_text_123",
            },
          },
        ),
      async () => {
        const response = await nanoGptChatModelsGet(
          new Request("https://studio.test/api/nanogpt/chat-models", {
            headers: { "x-user-api-key": "nano-secret" },
          }),
        );

        assert.equal(response.status, 429);
        assert.deepEqual(await response.json(), {
          error: "Rejected Bearer [redacted]",
          code: "rate_limited",
          parameter: "sort",
          requestId: "req_nano_text_123",
          retryAfterMs: 4_000,
          guidance: "Retry the catalog request later.",
        });
      },
    );
  });
});

test("NanoGPT chat catalog handles malformed JSON and network failures safely", async () => {
  await withoutNanoGptEnvironmentKey(async () => {
    await withFetch(
      async () => new Response("not-json", { status: 200 }),
      async () => {
        const response = await nanoGptChatModelsGet(
          new Request("https://studio.test/api/nanogpt/chat-models"),
        );
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          error: "Unable to parse NanoGPT text model catalog.",
        });
      },
    );

    await withFetch(
      async () => {
        throw new Error("fetch failed for Bearer network-secret");
      },
      async () => {
        const response = await nanoGptChatModelsGet(
          new Request("https://studio.test/api/nanogpt/chat-models", {
            headers: { "x-user-api-key": "network-secret" },
          }),
        );
        const payload = await response.json();
        assert.equal(response.status, 502);
        assert.doesNotMatch(payload.error, /network-secret/);
      },
    );
  });
});
