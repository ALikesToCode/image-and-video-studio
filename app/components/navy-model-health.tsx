import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import type { ModelOption } from "@/lib/constants";
import { getNavyModelAccessSummary } from "@/lib/navy-model-health";
import type { NavyModelHealth } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavyModelHealthProps {
    model?: ModelOption;
    health: NavyModelHealth | null;
    error: string | null;
    loading: boolean;
    updatedAt: string | null;
    currentPlan?: string | null;
    onRefresh?: () => void;
}

const titleCaseStatus = (value: string) =>
    value
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatTimestamp = (value: string | null) => {
    if (!value) return null;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toLocaleString();
};

export function NavyModelHealthSummary({
    model,
    health,
    error,
    loading,
    updatedAt,
    currentPlan,
    onRefresh,
}: NavyModelHealthProps) {
    const access = getNavyModelAccessSummary(model, currentPlan);
    const normalizedStatus = health?.status?.trim().toLowerCase() ?? null;
    const isOperational = normalizedStatus === "ok" || normalizedStatus === "healthy";
    const isChecking = loading || health?.inProgress === true;
    const healthLabel = isChecking
        ? "Checking"
        : isOperational
            ? "Operational"
            : normalizedStatus
                ? titleCaseStatus(normalizedStatus)
                : "No live result";
    const checkedAt = formatTimestamp(health?.lastChecked ?? updatedAt);
    const modelLabel = model?.label ?? health?.id ?? "Selected model";

    return (
        <section
            className="rounded-lg border border-border/40 bg-background/30 p-3"
            aria-label="Navy selected model health"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Selected model
                    </h3>
                    <p className="truncate text-sm font-medium text-foreground" title={modelLabel}>
                        {modelLabel}
                    </p>
                </div>
                {onRefresh ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={onRefresh}
                        disabled={loading || !model?.id}
                        aria-label={`Refresh health for ${modelLabel}`}
                        title="Refresh selected model health"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    </Button>
                ) : null}
            </div>

            <div className="mt-2 space-y-2" role="status" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2">
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            isOperational
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : isChecking
                                    ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                        )}
                    >
                        {isOperational ? (
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        ) : isChecking ? (
                            <Activity className="h-3 w-3" aria-hidden="true" />
                        ) : (
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        )}
                        {healthLabel}
                    </span>
                    {typeof health?.uptimePercent === "number" ? (
                        <span className="text-[11px] text-muted-foreground">
                            {health.uptimePercent.toFixed(1)}% rolling uptime
                        </span>
                    ) : null}
                </div>

                <div>
                    <div
                        className={cn(
                            "text-xs font-medium",
                            access.state === "eligible"
                                ? "text-emerald-700 dark:text-emerald-300"
                                : access.state === "restricted"
                                    ? "text-destructive"
                                    : "text-amber-700 dark:text-amber-300",
                        )}
                    >
                        Plan: {access.label}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {access.detail}
                    </p>
                </div>

                {health?.error || error ? (
                    <p className="text-[11px] text-destructive">
                        {health?.error ?? error}
                    </p>
                ) : null}
                {checkedAt ? (
                    <p className="text-[10px] text-muted-foreground/70">
                        Last checked {checkedAt}
                    </p>
                ) : null}
            </div>
        </section>
    );
}

export type { NavyModelHealthProps };
