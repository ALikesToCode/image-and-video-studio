import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../../app/api/multillm/video/route.ts";
import { parseVideoJobPayload } from "../multillm-proxy.ts";

test("MultiLLM forwards the selected NavyAI video resolution", async (t) => {
  let forwarded: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    forwarded = JSON.parse(String(init?.body));
    return Response.json({ id: "test-video", status: "processing" });
  });
  const response = await POST(new Request("https://studio.test/api/multillm/video", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-api-key": "synthetic-test-key" },
    body: JSON.stringify({ model: "navyai:veo-3.1", prompt: "A blue cube", resolution: "1080p" }),
  }));
  assert.equal(response.status, 202);
  assert.equal(forwarded.size, "1080p");
});

test("unsupported video sources fail before any upstream request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not fetch"); });
  for (const source of ["linkapi", "gguu", "aihubmix"]) {
    const response = await POST(new Request("https://studio.test/api/multillm/video", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-api-key": "synthetic-test-key" },
      body: JSON.stringify({ model: `${source}:video-model`, prompt: "A blue cube" }),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("completed video results accept provider envelopes while rejecting unsafe URLs", () => {
  for (const videoUrl of ["https://media.example/video.mp4", "http://127.0.0.1/video.mp4"]) {
    for (const envelope of [
      { video_url: videoUrl },
      { data: { videoUrl } },
      { data: { video_url: videoUrl } },
      { result: { videoUrl } },
      { result: { video_url: videoUrl } },
      { output: { video: { url: videoUrl } } },
    ]) {
      const parsed = parseVideoJobPayload({ status: "completed", ...envelope });
      assert.equal(parsed.done, true);
      if (videoUrl.startsWith("https:")) assert.equal(parsed.videoUrl, videoUrl);
      else assert.match(parsed.error ?? "", /unsafe/);
    }
  }
});
