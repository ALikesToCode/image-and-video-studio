import type { NanoGptUsageCounters, NavyUsageResponse } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

export type UsageUnavailable = {
  status: "unavailable";
  error: string;
  statusCode?: number;
  code?: string;
  requestId?: string;
  retryAfterMs?: number;
};

export type UsageSection<T> =
  | { status: "available"; data: T }
  | UsageUnavailable;

export type NanoGptUsageSummary = {
  from: string;
  to: string;
  asOf: string;
  totals: NanoGptUsageCounters;
};

export type NanoGptBalanceSummary = {
  usdBalance: string;
  usdSpendableBalance: string | null;
  usdPendingUsage: string | null;
  nanoBalance: string;
};

export type NanoGptQuotaWindow = {
  id:
    | "dailyImages"
    | "dailyInputTokens"
    | "weeklyInputTokens"
    | "daily"
    | "monthly";
  label: string;
  unit: "images" | "tokens" | "requests";
  used: number;
  remaining: number;
  percentUsed: number;
  resetAt: number;
};

export type NanoGptSubscriptionSummary = {
  active: boolean;
  state: string;
  provider: string | null;
  currentPeriodEnd: string | null;
  quotas: NanoGptQuotaWindow[];
};

export type MultiLlmUsageResponse = {
  updatedAt: string;
  operationsUrl: string;
  navyai: UsageSection<NavyUsageResponse>;
  nanogpt: {
    status: "available" | "partial" | "unavailable";
    usage: UsageSection<NanoGptUsageSummary>;
    balance: UsageSection<NanoGptBalanceSummary>;
    subscription: UsageSection<NanoGptSubscriptionSummary>;
  };
};

const USAGE_COUNTER_FIELDS = [
  "requests",
  "costUsd",
  "refundedUsd",
  "netCostUsd",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
] as const;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const boundedString = (value: unknown, maximumLength = 256) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
};

const optionalBoundedString = (value: unknown, maximumLength = 256) => {
  if (value === undefined || value === null || value === "") return null;
  return boundedString(value, maximumLength);
};

const finiteNonNegativeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const decimalString = (value: unknown) => {
  const normalized = boundedString(value, 128);
  return normalized && /^\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
};

const normalizeUsageCounters = (value: unknown) => {
  const record = asRecord(value);
  if (!record) return null;

  const counters: Partial<NanoGptUsageCounters> = {};
  for (const field of USAGE_COUNTER_FIELDS) {
    const number = finiteNonNegativeNumber(record[field]);
    if (number === null) return null;
    counters[field] = number;
  }
  return counters as NanoGptUsageCounters;
};

export const normalizeNavyUsage = (
  value: unknown,
): NavyUsageResponse | null => {
  const root = asRecord(value);
  const limits = asRecord(root?.limits);
  const usage = asRecord(root?.usage);
  const rateLimits = asRecord(root?.rate_limits);
  const perMinute = asRecord(rateLimits?.per_minute);
  const plan = boundedString(root?.plan, 128);
  const serverTimeUtc = boundedString(root?.server_time_utc, 64);

  const tokensPerDay = finiteNonNegativeNumber(limits?.tokens_per_day);
  const rpm = finiteNonNegativeNumber(limits?.rpm);
  const tokensUsed = finiteNonNegativeNumber(usage?.tokens_used_today);
  const tokensRemaining = finiteNonNegativeNumber(
    usage?.tokens_remaining_today,
  );
  const percentUsed = finiteNonNegativeNumber(usage?.percent_used);
  const resetsAtUtc = boundedString(usage?.resets_at_utc, 64);
  const resetsInMs = finiteNonNegativeNumber(usage?.resets_in_ms);
  const minuteLimit = finiteNonNegativeNumber(perMinute?.limit);
  const minuteUsed = finiteNonNegativeNumber(perMinute?.used);
  const minuteRemaining = finiteNonNegativeNumber(perMinute?.remaining);
  const minuteResetsInMs = finiteNonNegativeNumber(perMinute?.resets_in_ms);

  if (
    !root ||
    !plan ||
    !serverTimeUtc ||
    tokensPerDay === null ||
    rpm === null ||
    tokensUsed === null ||
    tokensRemaining === null ||
    percentUsed === null ||
    percentUsed > 100 ||
    !resetsAtUtc ||
    resetsInMs === null ||
    minuteLimit === null ||
    minuteUsed === null ||
    minuteRemaining === null ||
    minuteResetsInMs === null
  ) {
    return null;
  }

  return {
    plan,
    limits: {
      tokens_per_day: tokensPerDay,
      rpm,
    },
    usage: {
      tokens_used_today: tokensUsed,
      tokens_remaining_today: tokensRemaining,
      percent_used: percentUsed,
      resets_at_utc: resetsAtUtc,
      resets_in_ms: resetsInMs,
    },
    rate_limits: {
      per_minute: {
        limit: minuteLimit,
        used: minuteUsed,
        remaining: minuteRemaining,
        resets_in_ms: minuteResetsInMs,
      },
    },
    server_time_utc: serverTimeUtc,
  };
};

export const normalizeNanoGptUsage = (
  value: unknown,
): NanoGptUsageSummary | null => {
  const root = asRecord(value);
  const totals = normalizeUsageCounters(root?.totals);
  const from = boundedString(root?.from, 10);
  const to = boundedString(root?.to, 10);
  const asOf = boundedString(root?.asOf, 64);
  if (!root || root.object !== "usage" || !totals || !from || !to || !asOf) {
    return null;
  }
  return { from, to, asOf, totals };
};

export const normalizeNanoGptBalance = (
  value: unknown,
): NanoGptBalanceSummary | null => {
  const root = asRecord(value);
  const usdBalance = decimalString(root?.usd_balance);
  const nanoBalance = decimalString(root?.nano_balance);
  if (!root || !usdBalance || !nanoBalance) return null;

  const spendableValue = root.usd_spendable_balance;
  const pendingValue = root.usd_pending_usage;
  const usdSpendableBalance =
    spendableValue === undefined || spendableValue === null
      ? null
      : decimalString(spendableValue);
  const usdPendingUsage =
    pendingValue === undefined || pendingValue === null
      ? null
      : decimalString(pendingValue);
  if (
    (spendableValue !== undefined &&
      spendableValue !== null &&
      !usdSpendableBalance) ||
    (pendingValue !== undefined && pendingValue !== null && !usdPendingUsage)
  ) {
    return null;
  }

  return {
    usdBalance,
    usdSpendableBalance,
    usdPendingUsage,
    nanoBalance,
  };
};

const quotaDefinitions: Array<{
  id: NanoGptQuotaWindow["id"];
  label: string;
  unit: NanoGptQuotaWindow["unit"];
}> = [
  { id: "dailyImages", label: "Daily images", unit: "images" },
  { id: "dailyInputTokens", label: "Daily input", unit: "tokens" },
  { id: "weeklyInputTokens", label: "Weekly input", unit: "tokens" },
  { id: "daily", label: "Daily quota", unit: "requests" },
  { id: "monthly", label: "Monthly quota", unit: "requests" },
];

const normalizeQuotaWindow = (
  value: unknown,
  definition: (typeof quotaDefinitions)[number],
): NanoGptQuotaWindow | null => {
  const root = asRecord(value);
  const used = finiteNonNegativeNumber(root?.used);
  const remaining = finiteNonNegativeNumber(root?.remaining);
  const rawPercentUsed = finiteNonNegativeNumber(root?.percentUsed);
  const resetAt = finiteNonNegativeNumber(root?.resetAt);
  if (
    !root ||
    used === null ||
    remaining === null ||
    rawPercentUsed === null ||
    rawPercentUsed > 100 ||
    resetAt === null
  ) {
    return null;
  }

  return {
    ...definition,
    used,
    remaining,
    percentUsed: rawPercentUsed > 1 ? rawPercentUsed / 100 : rawPercentUsed,
    resetAt,
  };
};

export const normalizeNanoGptSubscription = (
  value: unknown,
): NanoGptSubscriptionSummary | null => {
  const root = asRecord(value);
  if (!root || typeof root.active !== "boolean") return null;

  const state = boundedString(root.state, 32);
  if (!state) return null;

  const quotas: NanoGptQuotaWindow[] = [];
  for (const definition of quotaDefinitions) {
    const rawQuota = root[definition.id];
    if (rawQuota === undefined || rawQuota === null) continue;
    const quota = normalizeQuotaWindow(rawQuota, definition);
    if (!quota) return null;
    quotas.push(quota);
  }

  const period = asRecord(root.period);
  return {
    active: root.active,
    state,
    provider: optionalBoundedString(root.provider, 64),
    currentPeriodEnd: optionalBoundedString(period?.currentPeriodEnd, 64),
    quotas,
  };
};
