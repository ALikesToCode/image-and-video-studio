import test from "node:test";
import assert from "node:assert/strict";

import type { PersistedGenerationJob } from "./types.ts";
import {
  restorePersistedGenerationJob,
  shouldPersistRemoteGenerationJob,
  shouldRestoreRemoteGenerationJob,
} from "./generation-job-persistence.ts";

const baseJob: PersistedGenerationJob = {
  id: "job-local-1",
  status: "running",
  mode: "image",
  provider: "navy",
  model: "flux",
  prompt: "A naval command room at dusk",
  createdAt: "2026-05-20T00:00:00.000Z",
  remoteJobId: "job_remote_1",
  saveToGallery: false,
};

test("remote jobs are persisted only while still active", () => {
  assert.equal(shouldPersistRemoteGenerationJob(baseJob), true);
  assert.equal(
    shouldPersistRemoteGenerationJob({ ...baseJob, status: "success" }),
    false
  );
  assert.equal(
    shouldPersistRemoteGenerationJob({ ...baseJob, remoteJobId: undefined }),
    false
  );
});

test("persisted remote jobs restore only when the matching provider key is available", () => {
  assert.equal(shouldRestoreRemoteGenerationJob(baseJob, "sk-navy"), true);
  assert.equal(shouldRestoreRemoteGenerationJob(baseJob, " "), false);
  assert.equal(
    shouldRestoreRemoteGenerationJob({ ...baseJob, status: "error" }, "sk-navy"),
    false
  );
});

test("restored remote jobs keep the original gallery preference", () => {
  assert.deepEqual(restorePersistedGenerationJob(baseJob, "sk-navy"), {
    ...baseJob,
    status: "queued",
    apiKey: "sk-navy",
    saveToGallery: false,
    progress: "Restoring remote job polling...",
  });

  assert.equal(
    restorePersistedGenerationJob(
      { ...baseJob, saveToGallery: undefined },
      "sk-navy"
    )?.saveToGallery,
    true
  );
});
