import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";

import { computeBackoffDelay, pollOperation } from "./polling.ts";

test("polling removes completed delay listeners", async () => {
  await pollOperation({
    poll: async (attempt, signal) => {
      assert.equal(getEventListeners(signal, "abort").length, 0);
      return attempt;
    },
    isDone: (attempt) => attempt === 12,
    getResult: (attempt) => attempt,
    intervalMs: 1,
    maxAttempts: 15,
  });
});

test("cancellation during a poll takes precedence over a late result", async () => {
  const controller = new AbortController();
  await assert.rejects(pollOperation({
    poll: async () => { controller.abort(); return "ready"; },
    isDone: () => true,
    getResult: (result) => result,
    signal: controller.signal,
    intervalMs: 1,
    maxAttempts: 2,
  }), { name: "AbortError" });
});

test("computeBackoffDelay applies factor, cap, and deterministic jitter", () => {
  assert.equal(
    computeBackoffDelay({
      attempt: 2,
      intervalMs: 100,
      factor: 2,
      maxIntervalMs: 450,
      jitterRatio: 0.1,
      random: () => 0.5,
    }),
    420
  );
});

test("pollOperation returns when done and reports progress", async () => {
  const attempts: number[] = [];
  const progress: Array<{ attempt: number; nextDelayMs: number }> = [];

  const result = await pollOperation({
    poll: async (attempt) => {
      attempts.push(attempt);
      return { done: attempt === 2, value: "ready" };
    },
    isDone: (value) => value.done,
    getResult: (value) => value.value,
    intervalMs: 10,
    maxAttempts: 5,
    onProgress: (state) => progress.push(state),
    sleep: async () => {},
  });

  assert.equal(result, "ready");
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(
    progress.map((entry) => entry.attempt),
    [1, 2]
  );
});

test("pollOperation cancels through AbortController", async () => {
  const controller = new AbortController();
  let sleepCalled = false;

  await assert.rejects(
    pollOperation({
      poll: async () => ({ done: false }),
      isDone: (value) => value.done,
      getResult: () => "never",
      intervalMs: 10,
      maxAttempts: 5,
      signal: controller.signal,
      sleep: async (_ms, signal) => {
        sleepCalled = true;
        controller.abort();
        if (signal.aborted) {
          throw new DOMException("Polling was cancelled.", "AbortError");
        }
      },
    }),
    /cancelled/
  );

  assert.equal(sleepCalled, true);
});

test("pollOperation times out after max attempts", async () => {
  await assert.rejects(
    pollOperation({
      poll: async () => ({ done: false }),
      isDone: (value) => value.done,
      getResult: () => "never",
      intervalMs: 10,
      maxAttempts: 2,
      sleep: async () => {},
    }),
    /timed out/
  );
});
