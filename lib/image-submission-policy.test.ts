import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveImageSubmissionAttempts,
  usesSingleImageSubmissionAttempt,
} from "./image-submission-policy.ts";

test("direct Navy image submissions retain a single attempt", () => {
  assert.equal(usesSingleImageSubmissionAttempt("navy"), true);
  assert.equal(resolveImageSubmissionAttempts({ provider: "navy", configuredAttempts: 4 }), 1);
  assert.equal(resolveImageSubmissionAttempts({ provider: "multillm", model: "navyai:flux", configuredAttempts: 4 }), 1);
});

test("MultiLLM image submissions honor the configured attempt limit", () => {
  assert.equal(usesSingleImageSubmissionAttempt("multillm"), false);
  assert.equal(resolveImageSubmissionAttempts({ provider: "multillm", configuredAttempts: 4 }), 4);
  assert.equal(resolveImageSubmissionAttempts({ provider: "multillm", remoteJobId: "job_123", configuredAttempts: 4 }), 1);
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
