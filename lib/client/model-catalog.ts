import type { ModelOption } from "../constants.ts";
import { formatProviderErrorForDisplay } from "./provider-error.ts";

export const fetchMultiLlmModelCatalog = async (
  kind: "chat" | "image" | "video" | "audio",
  apiKey: string,
  sanitize: (value: unknown) => ModelOption[],
) => {
  const response = await fetch(`/api/multillm/models?kind=${kind}`, {
    headers: apiKey.trim() ? { "x-user-api-key": apiKey.trim() } : undefined,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(formatProviderErrorForDisplay(payload, {
    fallback: `Unable to fetch MultiLLM ${kind} models.`, status: response.status,
  }));
  const models = sanitize(payload?.models ?? []);
  const failedSources: string[] = Array.isArray(payload?.failedSources)
    ? payload.failedSources.filter((source: unknown): source is string => typeof source === "string")
    : [];
  if (!models.length && !failedSources.length) throw new Error(`MultiLLM returned no ${kind} models.`);
  const warnings: string[] = Array.isArray(payload?.warnings)
    ? payload.warnings.filter((warning: unknown): warning is string => typeof warning === "string")
    : [];
  return { models, failedSources, warning: warnings.length ? warnings.join(" ") : null };
};
