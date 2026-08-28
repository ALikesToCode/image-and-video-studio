import assert from "node:assert/strict";
import test from "node:test";

import { summarizeChatMetrics } from "./chat-metrics.ts";

test("chat metrics count unique generated outputs, failures, and work", () => {
  const summary = summarizeChatMetrics({
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
      },
      {
        id: "tool-1",
        role: "tool",
        name: "generate_image",
        content: "Generated 2 images.",
        images: [{ id: "image-1" }, { id: "image-2" }],
        media: [{ id: "image-1" }, { id: "image-2" }],
      },
      {
        id: "tool-2",
        role: "tool",
        name: "generate_video",
        content: "Tool error: generation failed.",
      },
      {
        id: "transient",
        role: "tool",
        name: "generate_image",
        content: "Image generation failed.",
        transient: true,
      },
    ],
    busy: true,
    queuedTurns: 2,
    contextWindow: 1_000,
  });

  assert.deepEqual(summary, {
    tokenLabel: "Context left",
    tokenValue: 875,
    generatedOutputs: 2,
    failedGenerations: 1,
    activeWork: 1,
    queuedWork: 2,
    totalTokensUsed: 125,
  });
});

test("provider balance takes precedence over context estimates", () => {
  const summary = summarizeChatMetrics({
    messages: [],
    busy: false,
    queuedTurns: 0,
    providerTokensRemaining: 11_764_526,
    contextWindow: 1_000_000,
  });

  assert.equal(summary.tokenLabel, "Tokens left");
  assert.equal(summary.tokenValue, 11_764_526);
});

test("metrics expose token usage when no balance or context limit is known", () => {
  const summary = summarizeChatMetrics({
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        usage: { inputTokens: 12, outputTokens: 8 },
      },
      {
        id: "assistant-2",
        role: "assistant",
        usage: { totalTokens: 30 },
      },
    ],
    busy: false,
    queuedTurns: 0,
  });

  assert.equal(summary.tokenLabel, "Tokens used");
  assert.equal(summary.tokenValue, 50);
  assert.equal(summary.totalTokensUsed, 50);
});
