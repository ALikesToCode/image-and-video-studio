import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STUDIO_CHAT_OUTPUT_TOKENS,
  isOutputTokenLimitReached,
  normalizeStudioChatOutputTokens,
  resolvePromptRewriteOutputTokenBudgets,
  resolveStudioChatOutputTokenBudgets,
} from "./llm-output-budget.ts";

test("reserves model-aware output headroom for tool calls", () => {
  assert.deepEqual(
    resolveStudioChatOutputTokenBudgets({ hasTools: true }),
    [16_384, 32_768],
  );
  assert.deepEqual(
    resolveStudioChatOutputTokenBudgets({
      hasTools: true,
      modelMaxOutputTokens: 12_000,
    }),
    [12_000],
  );
  assert.deepEqual(
    resolveStudioChatOutputTokenBudgets({
      hasTools: false,
      modelMaxOutputTokens: 8_192,
    }),
    [4_096, 8_192],
  );
});

test("caps untrusted chat token requests at the server boundary", () => {
  assert.equal(normalizeStudioChatOutputTokens(undefined), 4_096);
  assert.equal(normalizeStudioChatOutputTokens(0.5), 1);
  assert.equal(normalizeStudioChatOutputTokens(12_345.9), 12_345);
  assert.equal(
    normalizeStudioChatOutputTokens(100_000),
    MAX_STUDIO_CHAT_OUTPUT_TOKENS,
  );
});

test("sizes prompt rewrites from the source and keeps one larger retry", () => {
  assert.deepEqual(resolvePromptRewriteOutputTokenBudgets("short"), [
    8_192,
    32_768,
  ]);
  assert.deepEqual(
    resolvePromptRewriteOutputTokenBudgets("x".repeat(40_000)),
    [16_384, 32_768],
  );
});

test("recognizes Responses and Chat Completions output limits", () => {
  assert.equal(
    isOutputTokenLimitReached({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    }),
    true,
  );
  assert.equal(
    isOutputTokenLimitReached({
      choices: [{ finish_reason: "length" }],
    }),
    true,
  );
  assert.equal(
    isOutputTokenLimitReached({
      status: "completed",
      choices: [{ finish_reason: "stop" }],
    }),
    false,
  );
});
