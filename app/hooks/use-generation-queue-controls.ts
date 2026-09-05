"use client";

import { useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { GenerationJob } from "@/lib/jobs/types";
import { cancelQueuedJobs, retryQueuedJob, trimJobHistory } from "@/lib/jobs/queue";

export function useGenerationQueueControls(
  setJobs: Dispatch<SetStateAction<GenerationJob[]>>,
  processing: RefObject<Set<string>>,
) {
  const [queuePaused, setQueuePaused] = useState(false);
  const [imageConcurrency, setImageConcurrency] = useState(4);
  return {
    queuePaused,
    setQueuePaused,
    imageConcurrency,
    setImageConcurrency: (value: number) => setImageConcurrency(Number.isInteger(value) ? Math.max(1, Math.min(4, value)) : 4),
    cancel: (id?: string) => setJobs((jobs) => trimJobHistory(cancelQueuedJobs(jobs, processing.current, id))),
    retry: (id: string) => setJobs((jobs) => retryQueuedJob(jobs, processing.current, id)),
  };
}
