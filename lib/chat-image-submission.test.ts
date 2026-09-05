import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import assert from "node:assert/strict";

import { runChatImageTool } from "../app/components/chat/chutes-chat-image-tool.ts";

const IMAGE = { data: "aGVsbG8=", mimeType: "image/png" };
const LINKAPI = "linkapi:gpt-image-2-c";
const GGUU = "gguu:gpt-image-2";
const options = (models = [LINKAPI]): Parameters<typeof runChatImageTool>[0] => ({
  args: { prompt: "A blue ceramic cup on a wooden table" },
  provider: "multillm",
  allowServerApiKey: true,
  imageModels: models.map((id) => ({ id, label: id })),
  imageProviderByModelId: new Map(models.map((id) => [id, "multillm"])),
  imageApiKeyForProvider: () => "",
  toolImageModel: models[0],
  imagePipelineEnabled: true,
  imageModelOrder: models,
  imageRetryAttempts: 3,
  preferMaximumImageQuality: false,
  recoverPrompt: async () => assert.fail("A gateway timeout must not rewrite the prompt"),
  requestPromptHelp: async () => assert.fail("Prompt help was not requested"),
});

for (const model of [LINKAPI, GGUU]) {
  test(`${model} reports the actual exhausted tries for repeated 524 failures`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1;
      return Response.json({ error: "error code: 524" }, { status: 524 });
    });
    await assert.rejects(withClock(t, () => runChatImageTool(options([model]))),
      /error code: 524 \[HTTP 524\] after 3 tries/);
    assert.equal(calls, 3);
  });
}

test("one configured try disables transient image resubmission", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("Gateway timed out", { status: 524 });
  });
  await assert.rejects(runChatImageTool({ ...options(), imageRetryAttempts: 1 }), /HTTP 524\] after 1 try/);
  assert.equal(calls, 1);
});

test("NavyAI keeps its existing single-submission policy for transient failures", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json({ error: "error code: 524" }, { status: 524 });
  });
  await assert.rejects(runChatImageTool(options(["navyai:flux"])), /after 1 try/);
  assert.equal(calls, 1);
});

for (const status of [400, 401, 402, 403, 404, 422]) {
  test(`HTTP ${status} submission failures stop immediately`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1;
      return Response.json({ error: "Request rejected" }, { status });
    });
    await assert.rejects(runChatImageTool(options()), /after 1 try/);
    assert.equal(calls, 1);
  });
}

test("a successful model is not repeated while another model retries", async (t) => {
  const calls = new Map<string, number>();
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const { model } = JSON.parse(String(init.body)) as { model: string };
    calls.set(model, (calls.get(model) ?? 0) + 1);
    return model === LINKAPI
      ? Response.json({ error: "error code: 524" }, { status: 524 })
      : Response.json({ images: [IMAGE] });
  });
  const result = await withClock(t, () => runChatImageTool(options([LINKAPI, GGUU])));
  assert.equal(calls.get(LINKAPI), 3);
  assert.equal(calls.get(GGUU), 1);
  assert.equal(result.images[0]?.model, GGUU);
  assert.match(result.errors[0], /after 3 tries/);
});

test("accepted image jobs are not resubmitted after polling fails", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit) => {
    calls.push(String(input));
    return init.method === "POST"
      ? Response.json({ id: "job_123", status: "queued" }, { status: 202 })
      : Response.json({ error: "error code: 524" }, { status: 524 });
  });
  await assert.rejects(runChatImageTool(options(["navyai:flux"])), /HTTP 524\] after 1 try/);
  assert.deepEqual(calls, ["/api/multillm/image", "/api/multillm/image?id=job_123&source=navyai"]);
});

test("an accepted job's policy failure does not trigger another submission", async (t) => {
  let submissions = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    if (init.method === "POST") {
      submissions += 1;
      return Response.json({ id: "job_123" }, { status: 202 });
    }
    return Response.json({ done: true, error: "content policy violation" });
  });
  await assert.rejects(runChatImageTool(options(["navyai:flux"])), /Async image job failed/);
  assert.equal(submissions, 1);
});

test("policy rewrites and transient retries share the same attempt budget", async (t) => {
  const prompts: string[] = [];
  let rewrites = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    prompts.push((JSON.parse(String(init.body)) as { prompt: string }).prompt);
    if (prompts.length === 1) return Response.json({ error: "content policy violation" }, { status: 400 });
    if (prompts.length === 2) return Response.json({ error: "error code: 524" }, { status: 524 });
    return Response.json({ images: [IMAGE] });
  });
  const result = await withClock(t, () => runChatImageTool({
    ...options(),
    recoverPrompt: async () => {
      rewrites += 1;
      return "A glazed blue cup in soft daylight";
    },
  }));
  assert.equal(result.images.length, 1);
  assert.equal(prompts.length, 3);
  assert.equal(rewrites, 1);
  assert.notEqual(prompts[0], prompts[1]);
  assert.equal(prompts[1], prompts[2]);
});

test("cancellation during the retry delay prevents the next submission", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json({ error: "error code: 524" }, { status: 524 });
  });
  const result = runChatImageTool({ ...options(), signal: controller.signal });
  const rejection = assert.rejects(result, /cancelled/);
  await setImmediate();
  controller.abort();
  await rejection;
  assert.equal(calls, 1);
});

test("an already cancelled tool sends no image request", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, "fetch", async () => assert.fail("Cancelled request was sent"));
  await assert.rejects(runChatImageTool({ ...options(), signal: controller.signal }), /aborted/);
});

const withClock = async <T>(t: TestContext, run: () => Promise<T>) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let settled = false;
  const result = run().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  ).finally(() => { settled = true; });
  for (let turn = 0; turn < 20 && !settled; turn += 1) {
    await setImmediate();
    if (!settled) t.mock.timers.tick(60_000);
  }
  assert.equal(settled, true, "Image tool did not finish within the retry budget");
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
};

test("chat retries LinkAPI and GGUU HTTP 524 responses within the configured tries", async (t) => {
  const models = ["linkapi:gpt-image-2-c", "gguu:gpt-image-2"];
  const requests = new Map<string, string[]>();
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string };
    const attempts = requests.get(body.model) ?? [];
    attempts.push(String(init.body));
    requests.set(body.model, attempts);
    return attempts.length === 1
      ? Response.json({ error: "error code: 524" }, { status: 524 })
      : Response.json({ images: [{ data: "aGVsbG8=", mimeType: "image/png" }] });
  });
  const result = await withClock(t, () => runChatImageTool(options(models)));
  assert.deepEqual(result.images.map((image) => image.model), models);
  assert.deepEqual(result.errors, []);
  for (const model of models) {
    const attempts = requests.get(model)!;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
  }
});
