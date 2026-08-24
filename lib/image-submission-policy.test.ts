import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveImageSubmissionAttempts,
  usesSingleImageSubmissionAttempt,
} from "./image-submission-policy.ts";

test("Navy-backed image submissions are never repeated automatically", () => {
  for (const provider of ["navy", "multillm"] as const) {
    assert.equal(usesSingleImageSubmissionAttempt(provider), true);
    assert.equal(
      resolveImageSubmissionAttempts({
        provider,
        configuredAttempts: 4,
      }),
      1,
    );
  }
});

test("resumed jobs and repeatable providers keep their intended policy", () => {
  assert.equal(
    resolveImageSubmissionAttempts({
      provider: "gemini",
      remoteJobId: "job_123",
      configuredAttempts: 4,
    }),
    1,
  );
  assert.equal(
    resolveImageSubmissionAttempts({
      provider: "gemini",
      configuredAttempts: 3,
    }),
    3,
  );
});
