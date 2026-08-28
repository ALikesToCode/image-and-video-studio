import test from "node:test";
import assert from "node:assert/strict";

import * as chatTooling from "./chat-tooling.ts";

test("chat tooling facade preserves the established public entrypoints", () => {
  assert.equal(typeof chatTooling.buildChatCompletionPayload, "function");
  assert.equal(typeof chatTooling.buildNanoGptImageToolRequest, "function");
  assert.equal(typeof chatTooling.repairImageToolArguments, "function");
  assert.equal(typeof chatTooling.resolveChatTurnIntent, "function");
  assert.equal(typeof chatTooling.runImageModelPipelineParallel, "function");
  assert.equal(typeof chatTooling.sanitizeChatMediaAssets, "function");
});
