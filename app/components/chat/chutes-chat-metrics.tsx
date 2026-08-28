"use client";

import { Activity, CircleAlert, Images, Sigma } from "lucide-react";

import type { ChatMetricsSummary } from "@/lib/chat-metrics";
import { cn } from "@/lib/utils";
import { ImageQualityToggle } from "../image-quality-toggle";

type ChutesChatMetricsProps = {
  metrics: ChatMetricsSummary;
  preferMaximumImageQuality: boolean;
  setPreferMaximumImageQuality: (enabled: boolean) => void;
};

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const exactNumber = new Intl.NumberFormat("en");

const metricValue = (value: number | null) =>
  value === null ? "—" : compactNumber.format(value);

export function ChutesChatMetrics({
  metrics,
  preferMaximumImageQuality,
  setPreferMaximumImageQuality,
}: ChutesChatMetricsProps) {
  const workValue = metrics.activeWork
    ? `${metrics.activeWork} active${metrics.queuedWork ? ` · ${metrics.queuedWork} queued` : ""}`
    : metrics.queuedWork
      ? `${metrics.queuedWork} queued`
      : "Idle";

  return (
    <div className="flex min-w-0 items-center justify-end gap-1.5">
      <ImageQualityToggle
        enabled={preferMaximumImageQuality}
        onChange={setPreferMaximumImageQuality}
        compact
        className="h-11"
      />
      <dl
        className="flex min-w-0 items-center gap-1.5"
        aria-live="polite"
        aria-label="Chat and generation metrics"
      >
        <div
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-foreground"
          title={
            metrics.tokenValue === null
              ? `${metrics.tokenLabel}: unavailable`
              : `${metrics.tokenLabel}: ${exactNumber.format(metrics.tokenValue)}`
          }
        >
          <Sigma className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-foreground/75">
              {metrics.tokenLabel}
            </dt>
            <dd className="text-xs font-semibold leading-4">
              {metricValue(metrics.tokenValue)}
            </dd>
          </span>
        </div>
        <div className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-foreground">
          <Images className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-foreground/75">
              Generated
            </dt>
            <dd className="text-xs font-semibold leading-4">
              {exactNumber.format(metrics.generatedOutputs)}
            </dd>
          </span>
        </div>
        <div className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-foreground">
          <Activity className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-foreground/75">
              Work
            </dt>
            <dd className="text-xs font-semibold leading-4">{workValue}</dd>
          </span>
        </div>
        {metrics.failedGenerations > 0 ? (
          <div
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3",
              "border-destructive/45 bg-destructive/10 text-destructive",
            )}
          >
            <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              <dt className="text-[9px] font-semibold uppercase tracking-wide">
                Failed
              </dt>
              <dd className="text-xs font-semibold leading-4">
                {metrics.failedGenerations}
              </dd>
            </span>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
