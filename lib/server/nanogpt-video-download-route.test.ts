import test from "node:test";
import assert from "node:assert/strict";

import { POST as nanoGptVideoDownloadPost } from "../../app/api/nanogpt/video/download/route.ts";

type NanoGptVideoDownloadRoute = {
  POST: (request: Request) => Promise<Response>;
};

const loadRoute = async (): Promise<NanoGptVideoDownloadRoute> => ({
  POST: nanoGptVideoDownloadPost,
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

const temporarilySetEnv = (key: string, value: string) => {
  const original = process.env[key];
  process.env[key] = value;
  return () => {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
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

const downloadRequest = (
  body: unknown,
  headers: HeadersInit = { "x-user-api-key": "nano-secret" }
) =>
  new Request("https://studio.test/api/nanogpt/video/download", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("NanoGPT video download resolves a nested completed URL before fetching bytes", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  const requests: Array<{
    url: string;
    headers: Headers;
    redirect?: RequestRedirect;
  }> = [];

  try {
    await withFetch(
      async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push({
          url,
          headers: new Headers(init?.headers),
          redirect: init?.redirect,
        });
        if (requests.length === 1) {
          return Response.json({
            requestId: "vid_download_123",
            data: {
              status: "COMPLETED",
              output: {
                video: {
                  url: "https://storage.nano.example/render.mp4?token=signed",
                },
              },
            },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "video/mp4",
            "content-length": "3",
          },
        });
      },
      async () => {
        const response = await POST(downloadRequest({ id: "vid_download_123" }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "video/mp4");
        assert.equal(response.headers.get("content-length"), "3");
        assert.deepEqual(
          Array.from(new Uint8Array(await response.arrayBuffer())),
          [1, 2, 3]
        );
      }
    );

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], {
      url: "https://nano-gpt.com/api/video/status?requestId=vid_download_123",
      headers: new Headers({ "x-api-key": "nano-secret" }),
      redirect: "error",
    });
    assert.equal(
      requests[1]?.url,
      "https://storage.nano.example/render.mp4?token=signed"
    );
    assert.equal(requests[1]?.headers.get("x-api-key"), null);
    assert.equal(requests[1]?.headers.get("authorization"), null);
    assert.equal(requests[1]?.redirect, "manual");
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download supports top-level completed responses on arbitrary public HTTPS storage", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  let requestNumber = 0;

  try {
    await withFetch(
      async () => {
        requestNumber += 1;
        if (requestNumber === 1) {
          return Response.json({
            requestId: "legacy-provider.request:download_123",
            status: "completed",
            videoUrl: "https://another-cdn.example.net/final.webm",
          });
        }
        return new Response(new Uint8Array([4, 5]), {
          headers: {
            "content-type": "video/webm",
            "content-length": "2",
          },
        });
      },
      async () => {
        const response = await POST(
          downloadRequest({ id: "legacy-provider.request:download_123" })
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "video/webm");
        assert.deepEqual(
          Array.from(new Uint8Array(await response.arrayBuffer())),
          [4, 5]
        );
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download uses the same provider-key precedence as submit and poll", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilySetEnv("NANOGPT_API_KEY", "server-fallback-key");
  let requestNumber = 0;

  try {
    await withFetch(
      async (_input, init) => {
        requestNumber += 1;
        if (requestNumber === 1) {
          assert.equal(
            new Headers(init?.headers).get("x-api-key"),
            "server-fallback-key"
          );
          return Response.json({
            status: "completed",
            videoUrl: "https://storage.nano.example/user-owned.mp4",
          });
        }
        return new Response(new Uint8Array([1]), {
          headers: { "content-type": "video/mp4" },
        });
      },
      async () => {
        const response = await POST(downloadRequest({ id: "vid_user_owned_123" }));
        assert.equal(response.status, 200);
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download rejects caller-supplied URLs and unknown body fields", async () => {
  const { POST } = await loadRoute();
  await withFetch(
    async () => {
      throw new Error("fetch must not run");
    },
    async () => {
      const response = await POST(
        downloadRequest({
          id: "vid_download_123",
          url: "https://attacker.example/video.mp4",
        })
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "Only a NanoGPT video job id is accepted.",
      });
    }
  );
});

test("NanoGPT video download validates the job id and provider credential before fetching", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () => {
        throw new Error("fetch must not run");
      },
      async () => {
        const invalidIdResponse = await POST(
          downloadRequest({ id: "../video/status" })
        );
        assert.equal(invalidIdResponse.status, 400);
        assert.deepEqual(await invalidIdResponse.json(), {
          error: "Invalid NanoGPT video job id.",
        });

        const missingKeyResponse = await POST(
          downloadRequest({ id: "vid_download_123" }, {})
        );
        assert.equal(missingKeyResponse.status, 400);
        assert.deepEqual(await missingKeyResponse.json(), {
          error: "Missing NanoGPT API key.",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download refuses jobs that are not completed", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json({
          requestId: "vid_pending_123",
          data: { status: "IN_PROGRESS" },
        }),
      async () => {
        const response = await POST(downloadRequest({ id: "vid_pending_123" }));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
          error: "NanoGPT video is not ready yet.",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download preserves actionable redacted terminal errors", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json({
          requestId: "vid_failed_123",
          data: {
            status: "FAILED",
            userFriendlyError:
              "Bearer nano-secret was rejected. Please revise the prompt.",
          },
        }),
      async () => {
        const response = await POST(downloadRequest({ id: "vid_failed_123" }));
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          error: "Bearer [redacted] was rejected. Please revise the prompt.",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download redacts status lookup failures", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  try {
    await withFetch(
      async () =>
        Response.json(
          { error: { message: "Key nano-secret is invalid" } },
          { status: 401 }
        ),
      async () => {
        const response = await POST(downloadRequest({ id: "vid_error_123" }));
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: "Key [redacted] is invalid",
        });
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download rejects private, credentialed, and redirected storage URLs", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);
  const unsafeUrls = [
    "https://127.0.0.1/render.mp4",
    "https://[::ffff:127.0.0.1]/render.mp4",
    "https://user:password@storage.example/render.mp4",
  ];

  try {
    for (const unsafeUrl of unsafeUrls) {
      let requestNumber = 0;
      await withFetch(
        async () => {
          requestNumber += 1;
          if (requestNumber > 1) throw new Error("media fetch must not run");
          return Response.json({
            status: "completed",
            videoUrl: unsafeUrl,
          });
        },
        async () => {
          const response = await POST(
            downloadRequest({ id: "vid_unsafe_url_123" })
          );
          assert.equal(response.status, 502);
          assert.deepEqual(await response.json(), {
            error: "NanoGPT returned an unsafe video URL.",
          });
          assert.equal(requestNumber, 1);
        }
      );
    }

    let requestNumber = 0;
    await withFetch(
      async () => {
        requestNumber += 1;
        if (requestNumber === 1) {
          return Response.json({
            status: "completed",
            videoUrl: "https://trusted-storage.example/render.mp4",
          });
        }
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal.mp4" },
        });
      },
      async () => {
        const response = await POST(
          downloadRequest({ id: "vid_unsafe_redirect_123" })
        );
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
          error: "Unable to download the completed NanoGPT video.",
        });
        assert.equal(requestNumber, 2);
      }
    );
  } finally {
    restoreEnv();
  }
});

test("NanoGPT video download enforces video content type and size bounds", async () => {
  const { POST } = await loadRoute();
  const restoreEnv = temporarilyUnsetEnv(["NANOGPT_API_KEY", "NANO_GPT_API_KEY"]);

  try {
    for (const mediaResponse of [
      new Response("html", { headers: { "content-type": "text/html" } }),
      new Response(new Uint8Array([1]), {
        headers: {
          "content-type": "video/mp4",
          "content-length": String(256 * 1024 * 1024 + 1),
        },
      }),
    ]) {
      let requestNumber = 0;
      await withFetch(
        async () => {
          requestNumber += 1;
          if (requestNumber === 1) {
            return Response.json({
              status: "completed",
              videoUrl: "https://trusted-storage.example/render.mp4",
            });
          }
          return mediaResponse.clone();
        },
        async () => {
          const response = await POST(
            downloadRequest({ id: "vid_invalid_media_123" })
          );
          assert.equal(response.status, 502);
          assert.deepEqual(await response.json(), {
            error: "Unable to download the completed NanoGPT video.",
          });
        }
      );
    }
  } finally {
    restoreEnv();
  }
});
