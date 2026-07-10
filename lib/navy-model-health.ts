import type { ModelOption } from "./constants";
import type {
  NavyModelHealth,
  NavyModelHealthSelection,
} from "./types";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nullableString = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim())
    ? (value as string | null)
    : undefined;

const nullableNumber = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value))
    ? (value as number | null)
    : undefined;

const nullableBoolean = (value: unknown) =>
  value === null || typeof value === "boolean"
    ? (value as boolean | null)
    : undefined;

export const selectLiveCatalogBucket = <T>(
  liveModels: T[],
  fallbackModels: T[],
): T[] => (liveModels.length ? liveModels : fallbackModels);

export const parseNavyModelHealthResponse = (
  payload: unknown,
  modelId: string,
): NavyModelHealthSelection | null => {
  const root = asRecord(payload);
  const models = asRecord(root?.models);
  const rawModel = asRecord(models?.[modelId]);
  if (!root || !models || !rawModel || rawModel.id !== modelId) return null;

  const endpoint = nullableString(rawModel.endpoint);
  const status = nullableString(rawModel.status);
  const lastChecked = nullableString(rawModel.lastChecked);
  const inProgress = nullableBoolean(rawModel.inProgress);
  const uptimePercent = nullableNumber(rawModel.uptimePercent);
  const checksCount = nullableNumber(rawModel.checksCount);
  const okCount = nullableNumber(rawModel.okCount);
  const avgTtft = nullableNumber(rawModel.avgTtft);
  const avgTotal = nullableNumber(rawModel.avgTotal);

  if (
    endpoint === undefined ||
    status === undefined ||
    lastChecked === undefined ||
    inProgress === undefined ||
    uptimePercent === undefined ||
    checksCount === undefined ||
    okCount === undefined ||
    avgTtft === undefined ||
    avgTotal === undefined
  ) {
    return null;
  }

  const error =
    typeof rawModel.error === "string" && rawModel.error.trim()
      ? rawModel.error.trim()
      : undefined;
  const model: NavyModelHealth = {
    id: modelId,
    endpoint,
    status,
    lastChecked,
    inProgress,
    uptimePercent,
    checksCount,
    okCount,
    avgTtft,
    avgTotal,
    ...(error ? { error } : {}),
  };

  return {
    lastUpdated: nullableString(root.lastUpdated) ?? null,
    model,
  };
};

export type NavyModelAccessSummary = {
  state: "eligible" | "restricted" | "unknown";
  label: string;
  detail: string;
};

export const getNavyModelAccessSummary = (
  model: ModelOption | undefined,
  currentPlan: string | null | undefined,
): NavyModelAccessSummary => {
  const requiredPlan = model?.requiredPlan?.trim();
  const normalizedRequiredPlan = requiredPlan?.toLowerCase();
  const normalizedCurrentPlan = currentPlan?.trim().toLowerCase();

  if (!requiredPlan && model?.premium !== true) {
    return {
      state: "eligible",
      label: "Eligible",
      detail: "No paid-plan requirement advertised.",
    };
  }

  if (requiredPlan && normalizedCurrentPlan === normalizedRequiredPlan) {
    return {
      state: "eligible",
      label: "Eligible",
      detail: `Current plan: ${currentPlan}. Required plan: ${requiredPlan} or higher.`,
    };
  }

  if (
    requiredPlan &&
    normalizedCurrentPlan === "free" &&
    normalizedRequiredPlan !== "free"
  ) {
    return {
      state: "restricted",
      label: "Upgrade required",
      detail: `Current plan: ${currentPlan}. Required plan: ${requiredPlan} or higher.`,
    };
  }

  if (requiredPlan) {
    return {
      state: "unknown",
      label: "Eligibility unconfirmed",
      detail: currentPlan
        ? `Current plan: ${currentPlan}. Required plan: ${requiredPlan} or higher.`
        : `Required plan: ${requiredPlan} or higher. Add a Navy API key to compare your plan.`,
    };
  }

  return {
    state: "unknown",
    label: "Paid plan required",
    detail: currentPlan
      ? `Current plan: ${currentPlan}. Navy does not advertise a specific required tier for this model.`
      : "Navy marks this model as premium but does not advertise a specific required tier.",
  };
};
