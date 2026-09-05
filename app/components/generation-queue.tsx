"use client";

import { useStudio } from "@/app/contexts/StudioContext";
import { Button } from "./ui/button";

export function GenerationQueue() {
  const { jobs, queueControls } = useStudio();
  const { queuePaused, setQueuePaused, imageConcurrency, setImageConcurrency, cancel, retry } = queueControls;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const active = jobs.filter((job) => ["queued", "running"].includes(job.status));
  const recent = jobs.filter((job) => !["queued", "running"].includes(job.status)).slice(-4).reverse();
  return <section className="mt-4 space-y-3 rounded-xl border border-border/50 bg-background/40 p-3" aria-label="Generation queue">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto text-sm font-semibold">Queue {queuePaused ? "paused" : "activity"}</h3>
      <Button size="sm" variant="outline" onClick={() => setQueuePaused(!queuePaused)}>{queuePaused ? "Resume queue" : "Pause queue"}</Button>
      <Button size="sm" variant="ghost" disabled={!queuedCount} onClick={() => cancel()}>Cancel waiting ({queuedCount})</Button>
    </div>
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Parallel image jobs
      <select className="rounded border bg-background p-1 text-foreground" value={imageConcurrency} onChange={(event) => setImageConcurrency(Number(event.target.value))}>
        {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    {queuePaused && <p className="text-xs text-muted-foreground">Running renders continue. Waiting jobs start when you resume.</p>}
    <div className="max-h-72 space-y-2 overflow-y-auto">
      {[...active, ...recent].map((job) => <div key={job.id} className="flex items-center gap-2 rounded-lg border border-border/40 p-2 text-xs">
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{job.model}</p><p className="break-words text-muted-foreground">{job.error || job.progress || job.status}</p></div>
        <span className="text-muted-foreground">{job.status}</span>
        {job.status === "queued" && <Button size="sm" variant="ghost" onClick={() => cancel(job.id)} aria-label={`Cancel ${job.model}`}>Cancel</Button>}
        {["error", "cancelled"].includes(job.status) && <Button size="sm" variant="outline" onClick={() => retry(job.id)} aria-label={`Retry ${job.model}`}>{job.remoteJobId || job.remoteOperationName ? "Resume" : "Retry"}</Button>}
      </div>)}
    </div>
  </section>;
}
