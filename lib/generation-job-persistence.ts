import type { PersistedGenerationJob } from "./types.ts";

type RemoteGenerationJobLike = Pick<
  PersistedGenerationJob,
  "status" | "provider" | "remoteJobId" | "remoteOperationName"
>;

const isActiveStatus = (status: PersistedGenerationJob["status"]) =>
  status === "queued" || status === "running";

const hasRemoteHandle = (job: RemoteGenerationJobLike) =>
  Boolean(job.remoteJobId || job.remoteOperationName);

export const shouldPersistRemoteGenerationJob = (
  job: RemoteGenerationJobLike
) => isActiveStatus(job.status) && hasRemoteHandle(job);

export const shouldRestoreRemoteGenerationJob = (
  job: RemoteGenerationJobLike,
  apiKey: string | undefined
) =>
  shouldPersistRemoteGenerationJob(job) &&
  (Boolean(apiKey?.trim()) || job.provider === "multillm");

export const restorePersistedGenerationJob = (
  job: PersistedGenerationJob,
  apiKey: string | undefined
) => {
  const trimmedKey = apiKey?.trim() ?? "";
  if (!shouldRestoreRemoteGenerationJob(job, trimmedKey)) return null;
  return {
    ...job,
    status: "queued" as const,
    apiKey: trimmedKey,
    saveToGallery: job.saveToGallery ?? true,
    progress: job.progress ?? "Restoring remote job polling...",
  };
};
