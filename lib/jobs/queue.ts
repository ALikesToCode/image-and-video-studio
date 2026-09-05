import type { JobStatus } from "./types.ts";

type ActiveJobLike = { status: JobStatus };
type QueueJobLike = ActiveJobLike & { id: string; mode: "image" | "video" | "tts" };

export const getActiveJobCount = (jobs: ActiveJobLike[]) =>
  jobs.filter((job) => job.status === "queued" || job.status === "running")
    .length;

export const getQueuedJobsToStart = (
  jobs: QueueJobLike[],
  {
    maxConcurrentImageJobs = 3,
    maxConcurrentNonImageJobs = 1,
    activeIds = [],
  }: {
    maxConcurrentImageJobs?: number;
    maxConcurrentNonImageJobs?: number;
    activeIds?: string[];
  } = {},
) => {
  const activeSet = new Set(activeIds);
  let availableImageSlots =
    maxConcurrentImageJobs -
    jobs.filter((job) => (job.status === "running" || activeSet.has(job.id)) && job.mode === "image")
      .length;
  let availableNonImageSlots =
    maxConcurrentNonImageJobs -
    jobs.filter((job) => (job.status === "running" || activeSet.has(job.id)) && job.mode !== "image")
      .length;

  const nextJobs: QueueJobLike[] = [];

  for (const job of jobs) {
    if (job.status !== "queued" || activeSet.has(job.id)) continue;

    if (job.mode === "image") {
      if (availableImageSlots <= 0) continue;
      nextJobs.push(job);
      availableImageSlots -= 1;
      continue;
    }

    if (availableNonImageSlots <= 0) continue;
    nextJobs.push(job);
    availableNonImageSlots -= 1;
  }

  return nextJobs;
};

export const trimJobHistory = <T extends ActiveJobLike>(items: T[], limit = 20): T[] => {
  const terminal = (job: T) => !["queued", "running"].includes(job.status);
  let overflow = items.filter(terminal).length - limit;
  return items.filter((job) => !terminal(job) || overflow-- <= 0);
};

export const cancelQueuedJobs = <T extends QueueJobLike>(jobs: T[], activeIds: ReadonlySet<string>, id?: string): T[] =>
  jobs.map((job) => job.status === "queued" && !activeIds.has(job.id) && (!id || job.id === id)
    ? { ...job, status: "cancelled", progress: "Cancelled before submission", finishedAt: new Date().toISOString() }
    : job);

export const retryQueuedJob = <T extends QueueJobLike>(jobs: T[], activeIds: ReadonlySet<string>, id: string): T[] =>
  jobs.map((job) => job.id === id && ["error", "cancelled"].includes(job.status) && !activeIds.has(id)
    ? { ...job, status: "queued", error: undefined, startedAt: undefined, finishedAt: undefined, progress: "Queued for retry" }
    : job);
