import test from "node:test";
import assert from "node:assert/strict";

import { resolveImageGenerationCallCeiling } from "./generation-cost.ts";

test("calculates the maximum image calls across models and policy attempts", () => {
  assert.equal(
    resolveImageGenerationCallCeiling({
      imageToolEnabled: true,
      activeModelCount: 3,
      maxAttemptsPerModel: 2,
    }),
    6,
  );
});

test("reports no image calls when the tool or catalog is unavailable", () => {
  assert.equal(
    resolveImageGenerationCallCeiling({
      imageToolEnabled: false,
      activeModelCount: 3,
      maxAttemptsPerModel: 2,
    }),
    0,
  );
  assert.equal(
    resolveImageGenerationCallCeiling({
      imageToolEnabled: true,
      activeModelCount: 0,
      maxAttemptsPerModel: 2,
    }),
    0,
  );
});
