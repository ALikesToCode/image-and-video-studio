import type { ModelOption } from "./constants";

const normalizeQuery = (query: string) => query.trim().toLowerCase();

export const mergeModelOptionLists = (
  modelLists: ModelOption[][],
  maxItems = Number.POSITIVE_INFINITY,
): ModelOption[] => {
  const merged = new Map<string, ModelOption>();
  const order: string[] = [];

  for (const models of modelLists) {
    for (const model of models) {
      if (!merged.has(model.id)) order.push(model.id);
      merged.set(model.id, { ...merged.get(model.id), ...model });
    }
  }

  return order
    .map((id) => merged.get(id))
    .filter((model): model is ModelOption => Boolean(model))
    .slice(0, maxItems);
};

export const optionSearchText = (model: ModelOption) =>
  [
    model.label,
    model.id,
    model.provider,
    model.endpoint,
    model.requiredPlan,
    model.modality,
    model.tokenizer,
    model.category,
    model.metadataSource,
    model.metadataStatus,
    model.description,
    ...(model.providers ?? []),
    ...(model.inputModalities ?? []),
    ...(model.outputModalities ?? []),
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join(" ")
    .toLowerCase();

export const filterModelOptions = (models: ModelOption[], query: string) => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return models;
  return models.filter((model) => optionSearchText(model).includes(normalizedQuery));
};

export const ensureSelectedModelOption = (
  models: ModelOption[],
  selectedModelId: string,
): ModelOption[] => {
  const id = selectedModelId.trim();
  if (!id || models.some((model) => model.id === id)) return models;
  return [
    {
      id,
      label: id,
      metadataStatus: "not in current catalog",
      description: "Saved model selection that was not returned by the latest model fetch.",
    },
    ...models,
  ];
};

export const isFetchedOnlyModel = (
  model: ModelOption,
  staticModelIds?: ReadonlySet<string>,
) => Boolean(staticModelIds && !staticModelIds.has(model.id));

export const hasModelMetadata = (model: ModelOption) =>
  Boolean(
    model.endpoint ||
      model.requiredPlan ||
      typeof model.tokenMultiplier === "number" ||
      model.contextWindow !== undefined ||
      model.maxOutputTokens !== undefined ||
      model.metadataStatus ||
      model.metadataSource !== undefined ||
      model.modality !== undefined ||
      model.tokenizer !== undefined ||
      model.category !== undefined ||
      model.providers !== undefined ||
      model.subscription !== undefined ||
      model.inputModalities !== undefined ||
      model.outputModalities !== undefined,
  );
