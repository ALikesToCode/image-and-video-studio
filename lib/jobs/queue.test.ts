import test from "node:test";
import assert from "node:assert/strict";
import { cancelQueuedJobs, getQueuedJobsToStart, retryQueuedJob, trimJobHistory } from "./queue.ts";

test("cancelling waiting jobs cannot cancel running or already dispatched submissions", () => {
  const jobs = [
    { id: "waiting", status: "queued" as const, mode: "image" as const },
    { id: "dispatched", status: "queued" as const, mode: "image" as const },
    { id: "running", status: "running" as const, mode: "image" as const },
  ];
  const cancelled = cancelQueuedJobs(jobs, new Set(["dispatched", "running"]));
  assert.deepEqual(cancelled.map((job) => job.status), ["cancelled", "queued", "running"]);
  assert.deepEqual(getQueuedJobsToStart(cancelled, { activeIds: ["dispatched", "running"] }), []);
});

test("retry preserves captured inputs and remote handles, and repeated clicks do not duplicate jobs", () => {
  const jobs = [{ id: "failed", status: "error" as const, mode: "video" as const, remoteJobId: "accepted", videoImage: "data:captured", error: "Polling timed out" }];
  const retry = retryQueuedJob(jobs, new Set(), "failed");
  assert.equal(retry[0].status, "queued");
  assert.equal(retry[0].remoteJobId, "accepted");
  assert.equal(retry[0].videoImage, "data:captured");
  assert.equal(retry[0].error, undefined);
  assert.deepEqual(retryQueuedJob(retry, new Set(), "failed"), retry);
});

test("history trimming retains active jobs while bounding cancelled history", () => {
  const jobs = [{ status: "queued" as const }, ...Array.from({ length: 25 }, () => ({ status: "cancelled" as const }))];
  const retained = trimJobHistory(jobs);
  assert.equal(retained.length, 21);
  assert.equal(retained[0].status, "queued");
});
