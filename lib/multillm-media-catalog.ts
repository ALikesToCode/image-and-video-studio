import type { ModelOption } from "./constants.ts";
import { normalizeModelOptions, type MultiLlmModelKind, type MultiLlmMediaSource } from "./multillm-proxy.ts";
import { normalizeNanoGptImageModels, normalizeNanoGptVideoModels } from "./nanogpt-media.ts";

export const normalizeMultiLlmMediaCatalog = (
  payload: unknown,
  options: {
    source?: MultiLlmMediaSource;
    kind?: Exclude<MultiLlmModelKind, "chat">;
    assumeKind?: boolean;
    idPrefix?: string;
    requireDeclaredImageOutput?: boolean;
  },
): ModelOption[] => {
  const models = normalizeModelOptions(payload, options);
  if (options.source !== "nanogpt" || !["image", "video"].includes(options.kind ?? "")) return models;
  const detailed = options.kind === "image"
    ? normalizeNanoGptImageModels(payload)
    : normalizeNanoGptVideoModels(payload);
  const detailsById = new Map(detailed.map((model) => [model.id.replace(/^nanogpt:/, ""), model]));
  return models.map((model) => {
    const details = detailsById.get(model.id.replace(/^nanogpt:/, ""));
    if (!details) return model;
    return {
      ...model,
      ...details,
      id: model.id,
      provider: model.provider,
      endpoint: model.endpoint,
      upstreamEndpoint: model.upstreamEndpoint,
      supports: { ...details.supports, [options.kind === "image" ? "imageGeneration" : "video"]: true },
    };
  });
};

export const mergePartialMultiLlmCatalog = (
  previous: readonly ModelOption[],
  incoming: readonly ModelOption[],
  failedSources: readonly string[],
): ModelOption[] => {
  const failed = new Set(failedSources);
  const preserved = previous.filter((model) => {
    const source = model.id.split(":", 1)[0];
    return failed.has(source) || (failed.has("unified") && !["navyai", "nanogpt", "linkapi"].includes(source));
  });
  const merged = new Map(preserved.map((model) => [model.id, model]));
  for (const model of incoming) merged.set(model.id, model);
  return [...merged.values()];
};
