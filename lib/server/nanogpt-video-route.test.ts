import test from "node:test";
import assert from "node:assert/strict";

import {
  GET as nanoGptVideoGet,
  POST as nanoGptVideoPost,
} from "../../app/api/nanogpt/video/route.ts";

type NanoGptVideoRoute = {
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
};

const loadRoute = async (): Promise<NanoGptVideoRoute> => ({
  GET: nanoGptVideoGet,
  POST: nanoGptVideoPost,
});

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

const withFetch = async (
  handler: typeof globalThis.fetch,
  run: () => Promise<void>
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const nanoRequest = (path: string, init: RequestInit = {}) =>
  new Request(`https://studio.test/api/nanogpt/video${path}`, {
    ...init,
    headers: {
      "x-user-api-key": "nano-secret",
      ...init.headers,
    },
  });

test("NanoGPT video submit forwards only safe scalar parameters and explicit media", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  let upstreamBody: Record<string, unknown> | null = null;
  let upstreamHeaders = new Headers();

  try {
    await withFetch(
      async (input, init) => {
        assert.equal(
          input instanceof Request ? input.url : String(input),
          "https://nano-gpt.com/api/generate-video"
        );
        upstreamHeaders = new Headers(init?.headers);
        upstreamBody =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        return Response.json(
          {
            runId: "vid_m1abc123def456",
            id: "vid_m1abc123def456",
            status: "pending",
            model: "sora-2",
            cost: 0.35,
            paymentSource: "XNO",
            remainingBalance: 12.5,
            prechargeLabel: "Sora generation",
          },
          { status: 202 }
        );
      },
      async () => {
        const response = await POST(
          nanoRequest("", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              apiKey: "body-key-must-not-be-forwarded",
              model: "sora-2",
              prompt: "A paper kite floating above the ocean",
              parameters: {
                duration: "5",
                resolution: "720p",
                seed: 42,
                generateAudio: true,
                model: "attacker/model",
                prompt: "override prompt",
                apiKey: "leak-me",
                authorization: "Bearer leak-me",
                imageUrl: "https://attacker.test/image.png",
                nested: { unsafe: true },
                list: ["unsafe"],
                empty: "   ",
                nil: null,
              },
              sourceImage: "data:image/png;base64,YWJj",
              referenceImages: [
                { dataUrl: "data:image/jpeg;base64,ZA==", role: "character" },
                "https://media.example.test/reference.png",
                { url: "javascript:alert(1)" },
                "https://user:password@media.example.test/private.png",
              ],
              sourceVideo: "https://media.example.test/source.mp4",
              referenceVideos: ["https://media.example.test/reference.mp4"],
              sourceAudio: "data:audio/mpeg;base64,YWJj",
            }),
          })
        );

        assert.equal(response.status, 202);
        assert.equal(upstreamHeaders.get("x-api-key"), "nano-secret");
        assert.equal(upstreamHeaders.get("authorization"), null);
        assert.deepEqual(upstreamBody, {
          model: "sora-2",
          prompt: "A paper kite floating above the ocean",
          duration: "5",
          resolution: "720p",
          seed: 42,
          generateAudio: true,
          imageDataUrl: "data:image/png;base64,YWJj",
          referenceImages: [
            "data:image/jpeg;base64,ZA==",
            "https://media.example.test/reference.png",
          ],
          videoUrl: "https://media.example.test/source.mp4",
          referenceVideos: ["https://media.example.test/reference.mp4"],
          audioDataUrl: "data:audio/mpeg;base64,YWJj",
        });
        assert.deepEqual(await response.json(), {
          id: "vid_m1abc123def456",
          runId: "vid_m1abc123def456",
          status: "pending",
          model: "sora-2",
          cost: 0.35,
          paymentSource: "XNO",
          remainingBalance: 12.5,
          prechargeLabel: "Sora generation",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video submit validates required fields before fetching", async () => {
  const { POST } = await loadRoute();
  await withFetch(
    async () => {
      throw new Error("fetch must not run");
    },
    async () => {
      const response = await POST(
        nanoRequest("", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "../unsafe", prompt: "" }),
        })
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "Missing or invalid required fields.",
      });
    }
  );
});

test("NanoGPT video submit redacts provider errors", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json(
          { error: { message: "Bearer nano-secret has insufficient balance" } },
          { status: 402 }
        ),
      async () => {
        const response = await POST(
          nanoRequest("", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: "sora-2", prompt: "A kite" }),
          })
        );
        assert.equal(response.status, 402);
        assert.deepEqual(await response.json(), {
          error: "Bearer [redacted] has insufficient balance",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video submit requires a safe provider job id", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () => Response.json({ runId: "../video/status" }, { status: 202 }),
      async () => {
        const response = await POST(
          nanoRequest("", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: "sora-2", prompt: "A kite" }),
          })
        );
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          error: "No valid job id returned by NanoGPT.",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling normalizes nested uppercase pending status", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async (input, init) => {
        assert.equal(
          input instanceof Request ? input.url : String(input),
          "https://nano-gpt.com/api/video/status?requestId=vid_pending_123"
        );
        assert.equal(new Headers(init?.headers).get("x-api-key"), "nano-secret");
        return Response.json({
          requestId: "vid_pending_123",
          model: "sora-2",
          data: {
            status: "IN_PROGRESS",
            requestId: "vid_pending_123",
            progress: 44,
            estimatedTimeRemaining: 18,
          },
        });
      },
      async () => {
        const response = await GET(nanoRequest("?id=vid_pending_123"));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          done: false,
          id: "vid_pending_123",
          status: "processing",
          model: "sora-2",
          progress: 44,
          estimatedTimeRemaining: 18,
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling normalizes nested completion and billing", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json({
          requestId: "vid_complete_123",
          model: "sora-2",
          data: {
            status: "COMPLETED",
            requestId: "vid_complete_123",
            output: { video: { url: "https://media.example.test/result.mp4" } },
            cost: 0.4,
            paymentSource: "USD",
            remainingBalance: 4.6,
          },
        }),
      async () => {
        const response = await GET(nanoRequest("?requestId=vid_complete_123"));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          done: true,
          id: "vid_complete_123",
          status: "completed",
          model: "sora-2",
          videoUrl: "https://media.example.test/result.mp4",
          cost: 0.4,
          paymentSource: "USD",
          remainingBalance: 4.6,
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling accepts the documented top-level lowercase shape", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json({
          requestId: "legacy-provider.request:abc_123",
          status: "completed",
          videoUrl: "https://media.example.test/legacy.mp4",
          completedAt: "2026-07-10T12:00:00.000Z",
        }),
      async () => {
        const response = await GET(
          nanoRequest("?runId=legacy-provider.request%3Aabc_123")
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          done: true,
          id: "legacy-provider.request:abc_123",
          status: "completed",
          videoUrl: "https://media.example.test/legacy.mp4",
          completedAt: "2026-07-10T12:00:00.000Z",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling returns actionable redacted terminal errors", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json({
          requestId: "vid_failed_123",
          data: {
            status: "FAILED",
            error: "Content policy violation",
            userFriendlyError:
              "Bearer nano-secret was flagged. Please revise the prompt.",
          },
        }),
      async () => {
        const response = await GET(nanoRequest("?id=vid_failed_123"));
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          done: true,
          id: "vid_failed_123",
          status: "failed",
          error: "Bearer [redacted] was flagged. Please revise the prompt.",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling treats canceled jobs as terminal failures", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json({
          requestId: "vid_canceled_123",
          status: "cancelled",
          error: "Generation canceled by the provider.",
        }),
      async () => {
        const response = await GET(nanoRequest("?id=vid_canceled_123"));
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          done: true,
          id: "vid_canceled_123",
          status: "canceled",
          error: "Generation canceled by the provider.",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling honors Retry-After without failing the job", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json(
          { error: "Too many requests" },
          { status: 429, headers: { "Retry-After": "3" } }
        ),
      async () => {
        const response = await GET(nanoRequest("?id=vid_rate_limited_123"));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("retry-after"), "3");
        assert.deepEqual(await response.json(), {
          done: false,
          id: "vid_rate_limited_123",
          status: "rate_limited",
          retryAfterMs: 3000,
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video polling rejects unsafe job ids before fetching", async () => {
  const { GET } = await loadRoute();
  await withFetch(
    async () => {
      throw new Error("fetch must not run");
    },
    async () => {
      const response = await GET(nanoRequest("?id=..%2Fvideo%2Fstatus"));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Invalid job id." });
    }
  );
});

test("NanoGPT video polling redacts non-terminal upstream errors", async () => {
  const { GET } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json(
          { message: "Key nano-secret is no longer valid" },
          { status: 401 }
        ),
      async () => {
        const response = await GET(nanoRequest("?id=vid_error_123"));
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: "Key [redacted] is no longer valid",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});
