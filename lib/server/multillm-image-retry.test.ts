import test from "node:test";
import assert from "node:assert/strict";

import { POST as imagePost } from "../../app/api/multillm/image/route.ts";
import { runChatImageTool } from "../../app/components/chat/chutes-chat-image-tool.ts";
import { runChatTools } from "../../app/components/chat/chutes-chat-tool-runner.ts";
import {
  isRetryableImageSubmissionError,
  submitImageRequest,
} from "../client/image-submission.ts";
import { requestGeneratedImages } from "../client/image-generation.ts";

const IMAGE = { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgSDvzHwADzgIyupqDXwAAAABJRU5ErkJggg==", mimeType: "image/png" };

for (const resultType of ["invalid-json", "missing-image", "failed-download"]) {
  test(`accepted ${resultType} responses do not become retryable generation failures`, async (t) => {
    t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
      if (init.method !== "POST") return new Response("Unavailable", { status: 503 });
      if (resultType === "invalid-json") return new Response("bad JSON");
      return Response.json(resultType === "missing-image" ? {} : {
        data: [{ url: "https://images.example.com/result.png" }],
      });
    });
    const response = await imagePost(new Request("https://studio.test/api/multillm/image", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-api-key": "test-proxy-key" },
      body: JSON.stringify({ model: "linkapi:gpt-image-2-c", prompt: "A blue ceramic cup" }),
    }));
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.code, "image_result_unavailable");
    t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status: response.status }));
    await assert.rejects(submitImageRequest("/api/multillm/image", {}), (error) => {
      assert.equal(isRetryableImageSubmissionError(error), false);
      return true;
    });
  });
}

for (const model of ["linkapi:gpt-image-2-c", "gguu:gpt-image-2"]) {
  for (const surface of ["chat", "standalone"]) {
    test(`${surface} recovers ${model} through the real route after upstream 524`, async (t) => {
      const originalBase = process.env.PROXY_BASE_URL;
      process.env.PROXY_BASE_URL = "https://proxy.test";
      t.after(() => {
        if (originalBase === undefined) delete process.env.PROXY_BASE_URL;
        else process.env.PROXY_BASE_URL = originalBase;
      });
      const bodies: Record<string, unknown>[] = [];
      t.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit) => {
        if (input === "/api/multillm/image") {
          return imagePost(new Request("https://studio.test/api/multillm/image", init));
        }
        const linkapi = model.startsWith("linkapi:");
        assert.equal(String(input), `https://proxy.test/${linkapi ? "linkapi/" : ""}v1/images/generations`);
        assert.equal(init.method, "POST");
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? new Response("error code: 524", { status: 524 })
          : Response.json({ data: [{ b64_json: IMAGE.data, mime_type: IMAGE.mimeType }] });
      });

      if (surface === "chat") {
        const progress: string[] = [];
        const generated: string[] = [];
        const messages = await runChatTools({
          provider: "multillm",
          toolSettings: { image: true, video: false, audio: false },
          imageModels: [{ id: model, label: model }],
          videoModels: [],
          audioModels: [],
          onGeneratedImage: (url) => generated.push(url),
          saveToGallery: false,
          refreshMediaUsage: () => undefined,
          runImage: (args, context, onModelProgress, signal) => runChatImageTool({
            args, context, onModelProgress, signal,
            provider: "multillm",
            allowServerApiKey: false,
            imageModels: [{ id: model, label: model }],
            imageProviderByModelId: new Map([[model, "multillm"]]),
            imageApiKeyForProvider: () => "test-proxy-key",
            toolImageModel: model,
            imagePipelineEnabled: false,
            imageModelOrder: [],
            imageRetryAttempts: 3,
            preferMaximumImageQuality: false,
            recoverPrompt: async () => assert.fail("Unexpected prompt rewrite"),
            requestPromptHelp: async () => assert.fail("Unexpected prompt help"),
          }),
          runVideo: async () => assert.fail("Unexpected video generation"),
          runAudio: async () => assert.fail("Unexpected audio generation"),
        }, [{
          id: "image-tool-call",
          type: "function",
          function: {
            name: "generate_image",
            arguments: JSON.stringify({ model, prompt: "A blue ceramic cup on a wooden table" }),
          },
        }], (message) => progress.push(message.content));
        assert.deepEqual(generated, [`data:image/png;base64,${IMAGE.data}`]);
        assert.equal(messages[0]?.images?.length, 1);
        assert.doesNotMatch(messages[0]?.content ?? "", /Tool error/);
        assert.ok(progress.some((message) => message.includes(`Waiting to retry ${model} (try 2/3)`)));
        assert.ok(progress.some((message) => message.includes(`Generated 1 image with ${model}`)));
      } else {
        const progress: string[] = [];
        const result = await requestGeneratedImages({
          id: "standalone-image", mode: "image", status: "queued", provider: "multillm", model,
          prompt: "A blue ceramic cup on a wooden table", apiKey: "test-proxy-key",
          createdAt: "2026-09-05T00:00:00Z", imageRetryAttempts: 3, saveToGallery: false,
        }, {
          referenceImages: [], nanoGptImageModels: [],
          updateJob: (_id, patch) => { if (patch.progress) progress.push(patch.progress); },
        });
        assert.equal(result.images.length, 1);
        assert.equal(result.images[0]?.dataUrl, `data:image/png;base64,${IMAGE.data}`);
        assert.equal(result.images[0]?.mimeType, IMAGE.mimeType);
        assert.ok(progress.some((message) => message.includes(`Retrying ${model} after try 1/3`)));
        assert.ok(progress.some((message) => message.includes(`Submitting image request to ${model} (try 2/3)`)));
      }
      assert.equal(bodies.length, 2);
      assert.deepEqual(bodies[0], bodies[1]);
      assert.equal(bodies[1].model, model.startsWith("linkapi:") ? "gpt-image-2-c" : model);
    });
  }
}
