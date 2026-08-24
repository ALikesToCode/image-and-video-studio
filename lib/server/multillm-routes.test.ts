import test from "node:test";
import assert from "node:assert/strict";

import {
  GET as multiLlmModelsGet,
} from "../../app/api/multillm/models/route.ts";
import {
  POST as multiLlmChatPost,
} from "../../app/api/multillm/chat/route.ts";
import {
  POST as multiLlmImagePost,
} from "../../app/api/multillm/image/route.ts";
import {
  GET as multiLlmVideoGet,
  POST as multiLlmVideoPost,
} from "../../app/api/multillm/video/route.ts";
import {
  POST as multiLlmAudioPost,
} from "../../app/api/multillm/audio/route.ts";

const ENV_KEYS = [
  "MULTILLM_API_KEY",
  "PROXY_BASE_URL",
  "MULTILLM_PROXY_BASE_URL",
] as const;

const withMultiLlmEnv = async (run: () => Promise<void>) => {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MULTILLM_API_KEY = "server-proxy-secret";
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

test("MultiLLM model discovery keeps healthy provider catalogs", async () => {
  await withMultiLlmEnv(async () => {
    await withFetch(
      async (input, init) => {
        const url = String(input);
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret"
        );
        if (url === "https://proxy.test/navyai/v1/models") {
          return Response.json({
            data: [
              {
                id: "flux",
                name: "Flux",
                endpoint: "images/generations",
              },
              {
                id: "gemini-3.1-flash-image",
                owned_by: "google",
                endpoint: "/v1/chat/completions",
                token_multiplier: 45,
                input_modalities: ["text", "image"],
                output_modalities: ["text", "image"],
                supports_image_output: true,
              },
            ],
          });
        }
        if (url === "https://proxy.test/linkapi/v1/models") {
          return Response.json({
            data: [
              { id: "gpt-image-2-c" },
              { id: "gemini-3.1-flash-image-preview" },
              { id: "gemini-3.1-flash-lite-image" },
            ],
          });
        }
        assert.equal(
          url,
          "https://proxy.test/nanogpt/v1/image-models?detailed=true"
        );
        return new Response("NanoGPT catalog unavailable", { status: 503 });
      },
      async () => {
        const response = await multiLlmModelsGet(
          new Request("https://studio.test/api/multillm/models?kind=image")
        );
        const payload = (await response.json()) as {
          models: Array<{ id: string; provider: string }>;
          warnings: string[];
        };

        assert.equal(response.status, 200);
        assert.deepEqual(
          payload.models.map(({ id, provider }) => ({ id, provider })),
          [
            { id: "navyai:flux", provider: "multillm" },
            {
              id: "navyai:gemini-3.1-flash-image",
              provider: "multillm",
            },
            { id: "linkapi:gpt-image-2-c", provider: "multillm" },
            {
              id: "linkapi:gemini-3.1-flash-image-preview",
              provider: "multillm",
            },
            {
              id: "linkapi:gemini-3.1-flash-lite-image",
              provider: "multillm",
            },
          ]
        );
        assert.equal(payload.warnings.length, 1);
        assert.match(payload.warnings[0], /NanoGPT catalog unavailable/);
        const navyChatImage = payload.models.find(
          (model) => model.id === "navyai:gemini-3.1-flash-image",
        ) as Record<string, unknown> | undefined;
        assert.equal(
          navyChatImage?.endpoint,
          "multillm-image-chat-completions",
        );
        assert.equal(navyChatImage?.upstreamEndpoint, "/v1/chat/completions");
        assert.equal(navyChatImage?.upstreamOwner, "google");
        assert.equal(navyChatImage?.tokenMultiplier, 45);
      }
    );
  });
});

test("MultiLLM sends LinkAPI Luna chat through the provider route", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/linkapi/v1/responses"
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret"
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        );
      },
      async () => {
        const response = await multiLlmChatPost(
          new Request("https://studio.test/api/multillm/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "linkapi:gpt-5.6-luna",
              messages: [{ role: "user", content: "Hello." }],
              maxTokens: 300,
              temperature: 0.7,
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.deepEqual(upstreamBody, {
          model: "gpt-5.6-luna",
          input: [{ role: "user", content: "Hello." }],
          stream: true,
          store: false,
          max_output_tokens: 300,
        });
      }
    );
  });
});

test("MultiLLM image generation strips the source prefix and returns base64 data", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/navyai/v1/images/generations"
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret"
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          data: [{ b64_json: "aGVsbG8=", mime_type: "image/png" }],
        });
      },
      async () => {
        const response = await multiLlmImagePost(
          new Request("https://studio.test/api/multillm/image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:flux",
              prompt: "A lighthouse in a storm",
              numberOfImages: 2,
              size: "1024x1024",
              sync: true,
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.deepEqual(upstreamBody, {
          model: "flux",
          prompt: "A lighthouse in a storm",
          n: 2,
          response_format: "b64_json",
          size: "1024x1024",
          sync: true,
        });
        assert.deepEqual(await response.json(), {
          images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
        });
      }
    );
  });
});

test("MultiLLM generates LinkAPI gpt-image-2-c images through the proxy", async () => {
  await withMultiLlmEnv(async () => {
    let generationCalls = 0;
    let downloadCalls = 0;
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        const url = String(input);
        if (
          url ===
          "https://proxy.test/linkapi/v1/images/generations"
        ) {
          generationCalls += 1;
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer server-proxy-secret"
          );
          upstreamBody = JSON.parse(
            String(init?.body)
          ) as Record<string, unknown>;
          return Response.json({
            data: [{ url: "https://cdn.example.test/linkapi.png" }],
          });
        }

        assert.equal(url, "https://cdn.example.test/linkapi.png");
        downloadCalls += 1;
        return new Response(Uint8Array.from([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      },
      async () => {
        const response = await multiLlmImagePost(
          new Request("https://studio.test/api/multillm/image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "linkapi:gpt-image-2-c",
              prompt: "A lighthouse in a storm",
              numberOfImages: 2,
              size: "1024x1024",
              aspectRatio: "1:1",
              quality: "standard",
              style: "vivid",
              negativePrompt: "text that LinkAPI does not accept",
              imageDataUrl: "data:image/png;base64,aWdub3JlZA==",
              sync: false,
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.deepEqual(upstreamBody, {
          model: "gpt-image-2-c",
          prompt: "A lighthouse in a storm",
          n: 2,
          response_format: "url",
          size: "1024x1024",
          quality: "standard",
          style: "vivid",
        });
        assert.deepEqual(await response.json(), {
          images: [{ data: "AQID", mimeType: "image/png" }],
        });
        assert.equal(generationCalls, 1);
        assert.equal(downloadCalls, 1);
      }
    );
  });
});

test("MultiLLM generates LinkAPI Gemini image models through chat completions", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/linkapi/v1/chat/completions"
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret"
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: "data:image/webp;base64,AQID",
                    },
                  },
                ],
              },
            },
          ],
        });
      },
      async () => {
        const response = await multiLlmImagePost(
          new Request("https://studio.test/api/multillm/image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "linkapi:gemini-3.1-flash-image-preview",
              prompt: "A lighthouse in a storm",
              negativePrompt: "text",
              numberOfImages: 2,
              size: "1024x1024",
              aspectRatio: "16:9",
              quality: "standard",
              imageDataUrl: "data:image/png;base64,aW5wdXQ=",
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.deepEqual(upstreamBody, {
          model: "gemini-3.1-flash-image-preview",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "A lighthouse in a storm\n\nAvoid: text",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64,aW5wdXQ=",
                  },
                },
              ],
            },
          ],
          modalities: ["image", "text"],
          n: 2,
          image_config: {
            image_size: "1024x1024",
            aspect_ratio: "16:9",
          },
        });
        assert.deepEqual(await response.json(), {
          images: [{ data: "AQID", mimeType: "image/webp" }],
        });
      }
    );
  });
});

test("MultiLLM generates Navy chat image models through the declared endpoint", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/navyai/v1/chat/completions",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer server-proxy-secret",
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({
          id: "chatcmpl_navy_image",
          choices: [
            {
              message: {
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url: "data:image/webp;base64,AQID",
                    },
                  },
                ],
              },
            },
          ],
        });
      },
      async () => {
        const response = await multiLlmImagePost(
          new Request("https://studio.test/api/multillm/image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:gemini-3.1-flash-image",
              modelEndpoint: "/v1/chat/completions",
              outputModalities: ["text", "image"],
              prompt: "A lighthouse in a storm",
              negativePrompt: "watermark",
              numberOfImages: 1,
              size: "1024x1024",
              aspectRatio: "16:9",
              imageDataUrl: "data:image/png;base64,aW5wdXQ=",
              sync: false,
            }),
          }),
        );

        assert.equal(response.status, 200);
        assert.deepEqual(upstreamBody, {
          model: "gemini-3.1-flash-image",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "A lighthouse in a storm\n\nAvoid: watermark",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64,aW5wdXQ=",
                  },
                },
              ],
            },
          ],
          modalities: ["image", "text"],
          image_config: {
            image_size: "1024x1024",
            aspect_ratio: "16:9",
          },
        });
        assert.deepEqual(await response.json(), {
          images: [{ data: "AQID", mimeType: "image/webp" }],
        });
      },
    );
  });
});

test("MultiLLM video polling never resubmits the generation job", async () => {
  await withMultiLlmEnv(async () => {
    let submitCount = 0;
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        const url = String(input);
        if (url === "https://proxy.test/navyai/v1/images/generations") {
          submitCount += 1;
          upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ id: "video-job-1", status: "processing" });
        }
        assert.equal(
          url,
          "https://proxy.test/navyai/v1/images/generations/video-job-1"
        );
        return Response.json({
          status: "completed",
          data: [{ url: "https://cdn.example.test/video.mp4" }],
        });
      },
      async () => {
        const submitResponse = await multiLlmVideoPost(
          new Request("https://studio.test/api/multillm/video", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:veo-3.1",
              prompt: "A ship crossing a glowing ocean",
              aspectRatio: "16:9",
              seconds: 8,
            }),
          })
        );
        assert.equal(submitResponse.status, 202);
        assert.deepEqual(await submitResponse.json(), {
          id: "video-job-1",
          source: "navyai",
          model: "veo-3.1",
          status: "processing",
        });

        const pollResponse = await multiLlmVideoGet(
          new Request(
            "https://studio.test/api/multillm/video?id=video-job-1&source=navyai"
          )
        );
        assert.equal(pollResponse.status, 200);
        assert.deepEqual(await pollResponse.json(), {
          done: true,
          status: "completed",
          videoUrl: "https://cdn.example.test/video.mp4",
        });
        assert.equal(submitCount, 1);
        assert.deepEqual(upstreamBody, {
          model: "veo-3.1",
          prompt: "A ship crossing a glowing ocean",
          aspect_ratio: "16:9",
          sync: false,
          seconds: 8,
        });
      }
    );
  });
});

test("MultiLLM rejects LinkAPI models on the video route", async () => {
  await withMultiLlmEnv(async () => {
    let fetched = false;
    await withFetch(
      async () => {
        fetched = true;
        throw new Error("fetch must not run");
      },
      async () => {
        const response = await multiLlmVideoPost(
          new Request("https://studio.test/api/multillm/video", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "linkapi:gpt-image-2-c",
              prompt: "A lighthouse in a storm",
            }),
          })
        );

        assert.equal(response.status, 400);
        assert.match(
          ((await response.json()) as { error: string }).error,
          /navyai: or nanogpt:/
        );
        assert.equal(fetched, false);
      }
    );
  });
});

test("MultiLLM audio generation streams provider audio", async () => {
  await withMultiLlmEnv(async () => {
    let upstreamBody: Record<string, unknown> = {};
    await withFetch(
      async (input, init) => {
        assert.equal(
          String(input),
          "https://proxy.test/navyai/v1/audio/speech"
        );
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/wav" },
        });
      },
      async () => {
        const response = await multiLlmAudioPost(
          new Request("https://studio.test/api/multillm/audio", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:tts-1",
              input: "Ready for launch.",
              voice: "alloy",
              speed: 1.1,
              responseFormat: "wav",
            }),
          })
        );

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "audio/wav");
        assert.deepEqual(upstreamBody, {
          model: "tts-1",
          input: "Ready for launch.",
          voice: "alloy",
          speed: 1.1,
          response_format: "wav",
        });
        assert.deepEqual(
          [...new Uint8Array(await response.arrayBuffer())],
          [1, 2, 3]
        );
      }
    );
  });
});

test("MultiLLM routes reject missing credentials before fetching", async () => {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  let fetched = false;
  try {
    await withFetch(
      async () => {
        fetched = true;
        throw new Error("fetch must not run");
      },
      async () => {
        const response = await multiLlmAudioPost(
          new Request("https://studio.test/api/multillm/audio", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "navyai:tts-1",
              input: "Hello",
            }),
          })
        );

        assert.equal(response.status, 400);
        assert.equal(fetched, false);
      }
    );
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
