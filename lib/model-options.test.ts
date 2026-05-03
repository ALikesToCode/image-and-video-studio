import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureSelectedModelOption,
  filterModelOptions,
  hasModelMetadata,
  isFetchedOnlyModel,
} from "./model-options.ts";
import type { ModelOption } from "./constants.ts";

const models: ModelOption[] = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    endpoint: "/v1/chat/completions",
    tokenMultiplier: 12,
    outputModalities: ["text"],
  },
  {
    id: "veo-3.1",
    label: "Veo 3.1",
    endpoint: "/v1/images/generations",
    outputModalities: ["video"],
  },
];

test("filterModelOptions searches labels, ids, endpoints, and modalities", () => {
  assert.deepEqual(
    filterModelOptions(models, "5.5").map((model) => model.id),
    ["gpt-5.5"],
  );
  assert.deepEqual(
    filterModelOptions(models, "images").map((model) => model.id),
    ["veo-3.1"],
  );
  assert.deepEqual(
    filterModelOptions(models, "video").map((model) => model.id),
    ["veo-3.1"],
  );
});

test("ensureSelectedModelOption preserves saved selections missing from the current catalog", () => {
  const withSaved = ensureSelectedModelOption(models, "new-model-preview");

  assert.equal(withSaved[0]?.id, "new-model-preview");
  assert.equal(withSaved[0]?.metadataStatus, "not in current catalog");
  assert.equal(withSaved.length, models.length + 1);
  assert.equal(ensureSelectedModelOption(models, "gpt-5.5"), models);
});

test("model metadata helpers identify fetched-only and annotated models", () => {
  assert.equal(isFetchedOnlyModel(models[0], new Set(["veo-3.1"])), true);
  assert.equal(isFetchedOnlyModel(models[1], new Set(["veo-3.1"])), false);
  assert.equal(hasModelMetadata(models[0]), true);
  assert.equal(hasModelMetadata({ id: "plain", label: "Plain" }), false);
});
