"use client";

import {
  Activity,
  CircleAlert,
  ExternalLink,
  Gauge,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/app/components/ui/button";
import type {
  MultiLlmUsageResponse,
  NanoGptQuotaWindow,
  UsageUnavailable,
} from "@/lib/multillm-usage";

type MultiLlmUsagePanelProps = {
  apiKey: string;
};

const CACHE_TTL_MS = 60_000;
let cachedReport:
  | { keyFingerprint: string; fetchedAt: number; report: MultiLlmUsageResponse }
  | null = null;

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const exactNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const usd = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

const formatCount = (value: number) =>
  value >= 10_000 ? compactNumber.format(value) : exactNumber.format(value);

const formatUsd = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? usd.format(parsed) : value;
};

const formatReset = (value: number | string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Reset time unavailable"
    : `Resets ${date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;
};

const fingerprintApiKey = async (apiKey: string) => {
  const bytes = new TextEncoder().encode(apiKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const loadReport = async (
  apiKey: string,
  signal: AbortSignal,
  force: boolean,
) => {
  const keyFingerprint = await fingerprintApiKey(apiKey);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (
    !force &&
    cachedReport?.keyFingerprint === keyFingerprint &&
    Date.now() - cachedReport.fetchedAt < CACHE_TTL_MS
  ) {
    return cachedReport.report;
  }

  const response = await fetch("/api/multillm/usage", {
    headers: { "x-user-api-key": apiKey },
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | MultiLlmUsageResponse
    | { error?: unknown }
    | null;
  if (!response.ok) {
    const message =
      payload &&
      "error" in payload &&
      typeof payload.error === "string" &&
      payload.error.length <= 1_000
        ? payload.error
        : "Unable to load MultiLLM usage.";
    throw new Error(message);
  }
  if (
    !payload ||
    !("updatedAt" in payload) ||
    typeof payload.updatedAt !== "string" ||
    !("navyai" in payload) ||
    !("nanogpt" in payload)
  ) {
    throw new Error("MultiLLM returned an invalid usage report.");
  }

  cachedReport = { keyFingerprint, fetchedAt: Date.now(), report: payload };
  return payload;
};

function StatusChip({ status }: { status: "available" | "partial" | "unavailable" }) {
  const label =
    status === "available"
      ? "Available"
      : status === "partial"
        ? "Partial"
        : "Unavailable";
  const color =
    status === "available"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : status === "partial"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border bg-secondary text-muted-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {label}
    </span>
  );
}

function SectionError({ label, error }: { label: string; error: UsageUnavailable }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium">{label}:</span> {error.error}
        {error.statusCode ? ` (${error.statusCode})` : ""}
      </span>
    </p>
  );
}

function QuotaBar({ quota }: { quota: NanoGptQuotaWindow }) {
  const percent = Math.min(100, Math.max(0, quota.percentUsed * 100));
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-2.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{quota.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatCount(quota.remaining)} {quota.unit} left
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label={`${quota.label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-[10px] text-muted-foreground">
        <span>{formatCount(quota.used)} used</span>
        <span>{formatReset(quota.resetAt)}</span>
      </div>
    </div>
  );
}

export function MultiLlmUsagePanel({ apiKey }: MultiLlmUsagePanelProps) {
  const normalizedKey = apiKey.trim();
  const [report, setReport] = useState<MultiLlmUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (force = true) => {
      if (!normalizedKey) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const nextReport = await loadReport(normalizedKey, controller.signal, force);
        if (!controller.signal.aborted) setReport(nextReport);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load MultiLLM usage.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [normalizedKey],
  );

  useEffect(() => {
    setReport(null);
    setError(null);
    if (!normalizedKey) {
      cachedReport = null;
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void refresh(false), 400);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [normalizedKey, refresh]);

  const nanoErrors = useMemo(() => {
    if (!report) return [];
    const sections: Array<[
      string,
      | typeof report.nanogpt.usage
      | typeof report.nanogpt.balance
      | typeof report.nanogpt.subscription,
    ]> = [
      ["Usage", report.nanogpt.usage],
      ["Balance", report.nanogpt.balance],
      ["Subscription", report.nanogpt.subscription],
    ];
    return sections.filter(
      (entry): entry is [string, UsageUnavailable] =>
        entry[1].status === "unavailable",
    );
  }, [report]);

  return (
    <section
      aria-labelledby="multillm-usage-heading"
      className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold" id="multillm-usage-heading">
            <Gauge className="h-4 w-4 text-sky-500" aria-hidden="true" />
            MultiLLM usage
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Provider-reported quota and billing data, not Studio cost estimates.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refresh(true)}
          disabled={!normalizedKey || loading}
          aria-label="Refresh MultiLLM provider usage"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      <div className="mt-4" aria-live="polite">
        {!normalizedKey ? (
          <p className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
            Add a browser-held MultiLLM key above to view private account usage. A shared
            deployment key is intentionally never used for this dashboard.
          </p>
        ) : error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : !report ? (
          <p className="text-xs text-muted-foreground">
            {loading ? "Checking provider accounts…" : "Refresh to check provider accounts."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-xl border border-border/60 bg-background/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 font-semibold">
                    <Activity className="h-4 w-4 text-sky-500" aria-hidden="true" />
                    NavyAI
                  </h4>
                  <StatusChip status={report.navyai.status} />
                </div>
                {report.navyai.status === "available" ? (
                  <div className="mt-3 space-y-3">
                    <dl className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-secondary/50 p-2.5">
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens left</dt>
                        <dd className="mt-1 font-semibold tabular-nums">
                          {formatCount(report.navyai.data.usage.tokens_remaining_today)}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-secondary/50 p-2.5">
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Plan</dt>
                        <dd className="mt-1 truncate font-semibold" title={report.navyai.data.plan}>
                          {report.navyai.data.plan}
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                        <span>{formatCount(report.navyai.data.usage.tokens_used_today)} used today</span>
                        <span>{report.navyai.data.usage.percent_used.toFixed(1)}%</span>
                      </div>
                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
                        role="progressbar"
                        aria-label="NavyAI daily token usage"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(report.navyai.data.usage.percent_used)}
                      >
                        <div
                          className="h-full rounded-full bg-sky-500"
                          style={{ width: `${Math.min(100, report.navyai.data.usage.percent_used)}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        {formatReset(report.navyai.data.usage.resets_at_utc)} · {report.navyai.data.rate_limits.per_minute.remaining}/{report.navyai.data.rate_limits.per_minute.limit} requests this minute
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <SectionError label="Usage" error={report.navyai} />
                  </div>
                )}
              </article>

              <article className="rounded-xl border border-border/60 bg-background/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 font-semibold">
                    <WalletCards className="h-4 w-4 text-sky-500" aria-hidden="true" />
                    NanoGPT
                  </h4>
                  <StatusChip status={report.nanogpt.status} />
                </div>
                <div className="mt-3 space-y-3">
                  <dl className="grid grid-cols-2 gap-2">
                    {report.nanogpt.balance.status === "available" ? (
                      <div className="rounded-lg bg-secondary/50 p-2.5">
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Spendable</dt>
                        <dd className="mt-1 font-semibold tabular-nums">
                          {formatUsd(
                            report.nanogpt.balance.data.usdSpendableBalance ??
                              report.nanogpt.balance.data.usdBalance,
                          )}
                        </dd>
                      </div>
                    ) : null}
                    {report.nanogpt.usage.status === "available" ? (
                      <>
                        <div className="rounded-lg bg-secondary/50 p-2.5">
                          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Net spend</dt>
                          <dd className="mt-1 font-semibold tabular-nums">
                            {usd.format(report.nanogpt.usage.data.totals.netCostUsd)}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-secondary/50 p-2.5">
                          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Requests</dt>
                          <dd className="mt-1 font-semibold tabular-nums">
                            {formatCount(report.nanogpt.usage.data.totals.requests)}
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                  {report.nanogpt.subscription.status === "available" ? (
                    report.nanogpt.subscription.data.quotas.length ? (
                      <div className="space-y-2">
                        {report.nanogpt.subscription.data.quotas.map((quota) => (
                          <QuotaBar key={quota.id} quota={quota} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No active subscription quota windows were returned.
                      </p>
                    )
                  ) : null}
                  {nanoErrors.map(([label, section]) => (
                    <SectionError key={label} label={label} error={section} />
                  ))}
                </div>
              </article>
            </div>

            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <a
                href={report.operationsUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border/60 bg-background/60 p-2.5 text-foreground transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  Proxy telemetry <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-muted-foreground">Operations login · local estimates</span>
              </a>
              <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                <span className="font-medium">OpenCode Go quota</span>
                <span className="mt-1 block text-muted-foreground">Console only · no public endpoint</span>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                <span className="font-medium">Roleplay metrics</span>
                <span className="mt-1 block text-muted-foreground">Session-scoped · not used by Studio chat</span>
              </div>
            </div>
            <p className="text-right text-[10px] text-muted-foreground">
              Updated {new Date(report.updatedAt).toLocaleTimeString()} · Provider data may use different reset windows
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
