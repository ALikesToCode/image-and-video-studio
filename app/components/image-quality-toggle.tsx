"use client";

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

type ImageQualityToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  compact?: boolean;
  className?: string;
};

export function ImageQualityToggle({
  enabled,
  onChange,
  compact = false,
  className,
}: ImageQualityToggleProps) {
  const stateLabel = enabled ? "On" : "Off";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`Maximum image quality: ${stateLabel}`}
      title={
        enabled
          ? "Maximum image quality is on. Image tools request the highest supported size and quality."
          : "Maximum image quality is off. Image tools use the selected or model-default settings."
      }
      onClick={() => onChange(!enabled)}
      className={cn(
        "group inline-flex min-h-11 shrink-0 items-center rounded-xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        enabled
          ? "border-primary/45 bg-primary/15 text-foreground hover:bg-primary/20"
          : "border-border bg-background text-foreground hover:border-primary/45 hover:bg-primary/10",
        compact ? "gap-2" : "w-full justify-between gap-3",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Sparkles
          className={cn("h-4 w-4 shrink-0", enabled ? "text-primary" : "text-foreground")}
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">
            Max quality
          </span>
          {!compact ? (
            <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
              Use the highest supported image size and quality.
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground">
          {stateLabel}
        </span>
        <span
          className={cn(
            "relative h-5 w-9 rounded-full border transition-colors",
            enabled
              ? "border-primary bg-primary"
              : "border-border bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-[17px]" : "translate-x-0.5",
            )}
          />
        </span>
      </span>
    </button>
  );
}
