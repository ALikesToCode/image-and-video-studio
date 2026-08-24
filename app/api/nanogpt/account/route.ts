import {
  getProviderApiKey,
  jsonOrNull,
  providerErrorDetails,
} from "@/lib/api-safety";

type UnknownRecord = Record<string, unknown>;

const NANOGPT_USAGE_URL = "https://nano-gpt.com/api/v1/usage";
const NANOGPT_BALANCE_URL = "https://nano-gpt.com/api/check-balance";
const NANOGPT_SUBSCRIPTION_USAGE_URL =
  "https://nano-gpt.com/api/subscription/v1/usage";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_USAGE_RANGE_DAYS = 366;
const USAGE_GROUPINGS = new Set(["day", "model", "day,model", "model,day"]);
const USAGE_QUERY_PARAMETERS = new Set(["from", "to", "group_by"]);
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

const accountJson = (
  payload: unknown,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {},
) => {
  const headers = new Headers(NO_STORE_HEADERS);
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return Response.json(payload, { ...init, headers });
};

const boundedString = (value: unknown, maximumLength = 512) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
};

const nullableBoundedString = (value: unknown, maximumLength = 512) => {
  if (value === null || value === undefined) return null;
  return boundedString(value, maximumLength);
};

const finiteNonNegativeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const isUtcDate = (value: string) => {
  if (!DATE_PATTERN.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
};

const parseUsageQuery = (requestUrl: string) => {
  const searchParams = new URL(requestUrl).searchParams;
  for (const key of searchParams.keys()) {
    if (!USAGE_QUERY_PARAMETERS.has(key)) {
      return { error: "Unsupported NanoGPT account query parameter." } as const;
    }
    if (searchParams.getAll(key).length !== 1) {
      return { error: "NanoGPT account query parameters cannot repeat." } as const;
    }
  }

  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";
  const groupBy = searchParams.get("group_by")?.trim() ?? "";

  if (Boolean(from) !== Boolean(to)) {
    return {
      error: "NanoGPT usage dates require both from and to.",
    } as const;
  }
  if (from && (!isUtcDate(from) || !isUtcDate(to))) {
    return {
      error: "NanoGPT usage dates must use YYYY-MM-DD UTC dates.",
    } as const;
  }
  if (from) {
    const fromTime = Date.parse(`${from}T00:00:00.000Z`);
    const toTime = Date.parse(`${to}T00:00:00.000Z`);
    const today = new Date().toISOString().slice(0, 10);
    const todayTime = Date.parse(`${today}T00:00:00.000Z`);
    const maximumRange = (MAX_USAGE_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000;
    if (toTime < fromTime || toTime > todayTime || toTime - fromTime > maximumRange) {
      return {
        error: "NanoGPT usage date range is invalid or exceeds 366 days.",
      } as const;
    }
  }
  if (groupBy && !USAGE_GROUPINGS.has(groupBy)) {
    return {
      error: "NanoGPT usage grouping must be day, model, or day,model.",
    } as const;
  }

  const upstream = new URL(NANOGPT_USAGE_URL);
  if (from) {
    upstream.searchParams.set("from", from);
    upstream.searchParams.set("to", to);
  }
  if (groupBy) upstream.searchParams.set("group_by", groupBy);
  return { url: upstream.toString() } as const;
};

const normalizeUsageBucket = (
  value: unknown,
  dimensions: { date?: boolean; model?: boolean } = {},
) => {
  const record = asRecord(value);
  if (!record) return null;

  const output: UnknownRecord = {};
  if (dimensions.date) {
    const date = boundedString(record.date, 10);
    if (!date || !isUtcDate(date)) return null;
    output.date = date;
  }
  if (dimensions.model) {
    const model = boundedString(record.model, 256);
    if (!model) return null;
    output.model = model;
  }
  for (const key of USAGE_COUNTER_FIELDS) {
    const normalized = finiteNonNegativeNumber(record[key]);
    if (normalized === null) return null;
    output[key] = normalized;
  }
  return output;
};

const normalizeUsageArray = (
  value: unknown,
  dimensions: { date?: boolean; model?: boolean },
) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const output: UnknownRecord[] = [];
  for (const item of value) {
    const normalized = normalizeUsageBucket(item, dimensions);
    if (!normalized) return null;
    output.push(normalized);
  }
  return output;
};

const normalizeUsage = (value: unknown) => {
  const root = asRecord(value);
  const totals = normalizeUsageBucket(root?.totals);
  const from = boundedString(root?.from, 10);
  const to = boundedString(root?.to, 10);
  const timezone = boundedString(root?.timezone, 16);
  const groupBy = boundedString(root?.groupBy, 16);
  const asOf = boundedString(root?.asOf, 64);
  if (
    !root ||
    root.object !== "usage" ||
    !totals ||
    !from ||
    !to ||
    !isUtcDate(from) ||
    !isUtcDate(to) ||
    timezone !== "UTC" ||
    !groupBy ||
    !USAGE_GROUPINGS.has(groupBy) ||
    !asOf
  ) {
    return null;
  }

  const byDay = normalizeUsageArray(root.byDay, { date: true });
  const byModel = normalizeUsageArray(root.byModel, { model: true });
  const byDayModel = normalizeUsageArray(root.byDayModel, {
    date: true,
    model: true,
  });
  if (byDay === null || byModel === null || byDayModel === null) return null;

  return {
    from,
    to,
    timezone,
    groupBy: groupBy === "model,day" ? "day,model" : groupBy,
    asOf,
    totals,
    ...(byDay ? { byDay } : {}),
    ...(byModel ? { byModel } : {}),
    ...(byDayModel ? { byDayModel } : {}),
  };
};

const normalizeBalance = (value: unknown) => {
  const root = asRecord(value);
  const usdBalance = boundedString(root?.usd_balance, 128);
  const nanoBalance = boundedString(root?.nano_balance, 128);
  const depositAddress = boundedString(root?.nanoDepositAddress, 256);
  if (!root || !usdBalance || !nanoBalance || !depositAddress) return null;
  return { usdBalance, nanoBalance, depositAddress };
};

const normalizeSubscriptionWindow = (value: unknown) => {
  const root = asRecord(value);
  if (!root) return null;
  const used = finiteNonNegativeNumber(root.used);
  const remaining = finiteNonNegativeNumber(root.remaining);
  const percentUsed = finiteNonNegativeNumber(root.percentUsed);
  const resetAt = finiteNonNegativeNumber(root.resetAt);
  if (
    used === null ||
    remaining === null ||
    percentUsed === null ||
    resetAt === null
  ) {
    return null;
  }
  return { used, remaining, percentUsed, resetAt };
};

const normalizeSubscriptionUsage = (value: unknown) => {
  const root = asRecord(value);
  const limits = asRecord(root?.limits);
  const dailyLimit = finiteNonNegativeNumber(limits?.daily);
  const monthlyLimit = finiteNonNegativeNumber(limits?.monthly);
  const daily = normalizeSubscriptionWindow(root?.daily);
  const monthly = normalizeSubscriptionWindow(root?.monthly);
  const period = asRecord(root?.period);
  const currentPeriodEnd = nullableBoundedString(period?.currentPeriodEnd, 64);
  const graceUntil = nullableBoundedString(root?.graceUntil, 64);
  const state = boundedString(root?.state, 16);

  if (
    !root ||
    typeof root.active !== "boolean" ||
    typeof root.enforceDailyLimit !== "boolean" ||
    dailyLimit === null ||
    monthlyLimit === null ||
    !daily ||
    !monthly ||
    !state ||
    !["active", "grace", "inactive"].includes(state)
  ) {
    return null;
  }

  return {
    active: root.active,
    state,
    enforceDailyLimit: root.enforceDailyLimit,
    limits: { daily: dailyLimit, monthly: monthlyLimit },
    daily,
    monthly,
    currentPeriodEnd,
    graceUntil,
  };
};

type AccountSection = "usage" | "balance" | "subscription";

const upstreamFailure = (
  section: AccountSection,
  payload: unknown,
  response: Response,
  apiKey: string,
) => {
  const labels: Record<AccountSection, string> = {
    usage: "Unable to fetch NanoGPT account usage.",
    balance: "Unable to fetch NanoGPT account balance.",
    subscription: "Unable to fetch NanoGPT subscription usage.",
  };
  return {
    ...providerErrorDetails(payload, labels[section], {
      knownSecrets: [apiKey],
      response,
    }),
    section,
    status: response.status,
  };
};

const providerFetch = (url: string, apiKey: string, mode: "bearer" | "api-key", method = "GET") =>
  fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(mode === "bearer"
        ? { Authorization: `Bearer ${apiKey}` }
        : { "x-api-key": apiKey }),
    },
    cache: "no-store",
    redirect: "error",
  });

export async function GET(req: Request) {
  const usageQuery = parseUsageQuery(req.url);
  if ("error" in usageQuery) {
    return accountJson({ error: usageQuery.error }, { status: 400 });
  }

  const apiKey = getProviderApiKey("nanogpt", req);
  if (!apiKey) {
    return accountJson(
      { error: "NanoGPT API key is required." },
      { status: 401 },
    );
  }

  const results = await Promise.allSettled([
    providerFetch(usageQuery.url, apiKey, "bearer"),
    providerFetch(NANOGPT_BALANCE_URL, apiKey, "api-key", "POST"),
    providerFetch(NANOGPT_SUBSCRIPTION_USAGE_URL, apiKey, "bearer"),
  ]);

  const sections = ["usage", "balance", "subscription"] as const;
  const responses: Array<Response | null> = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    if (sections[index] === "subscription") return null;
    return null;
  });

  for (let index = 0; index < 2; index += 1) {
    const response = responses[index];
    const section = sections[index];
    if (!response) {
      return accountJson(
        {
          error: `Unable to fetch NanoGPT account ${section}.`,
          section,
        },
        { status: 502 },
      );
    }
  }

  const payloads = await Promise.all(
    responses.map((response) => (response ? jsonOrNull(response) : null)),
  );

  for (let index = 0; index < 2; index += 1) {
    const response = responses[index] as Response;
    if (!response.ok) {
      const failure = upstreamFailure(
        sections[index],
        payloads[index],
        response,
        apiKey,
      );
      const { status, ...body } = failure;
      return accountJson(body, { status });
    }
  }

  const usage = normalizeUsage(payloads[0]);
  if (!usage) {
    return accountJson(
      {
        error: "NanoGPT returned an invalid usage response.",
        section: "usage",
      },
      { status: 502 },
    );
  }
  const balance = normalizeBalance(payloads[1]);
  if (!balance) {
    return accountJson(
      {
        error: "NanoGPT returned an invalid balance response.",
        section: "balance",
      },
      { status: 502 },
    );
  }

  const warnings: UnknownRecord[] = [];
  let subscription = null;
  const subscriptionResponse = responses[2];
  if (!subscriptionResponse) {
    warnings.push({
      section: "subscription",
      status: 502,
      error: "Unable to fetch NanoGPT subscription usage.",
    });
  } else if (!subscriptionResponse.ok) {
    warnings.push(
      upstreamFailure(
        "subscription",
        payloads[2],
        subscriptionResponse,
        apiKey,
      ),
    );
  } else {
    subscription = normalizeSubscriptionUsage(payloads[2]);
    if (!subscription) {
      warnings.push({
        section: "subscription",
        status: 502,
        error: "NanoGPT returned an invalid subscription usage response.",
      });
    }
  }

  return accountJson({
    balance,
    usage,
    subscription,
    ...(warnings.length ? { warnings } : {}),
  });
}
