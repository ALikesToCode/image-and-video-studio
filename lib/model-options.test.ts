import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureSelectedModelOption,
  filterModelOptions,
  hasModelMetadata,
  isFetchedOnlyModel,
  mergeModelOptionLists,
} from "./model-options.ts";
import {
  MULTILLM_IMAGE_MODELS,
  type ModelOption,
} from "./constants.ts";

const models: ModelOption[] = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    endpoint: "/v1/chat/completions",
    tokenMultiplier: 12,
    category: "reasoning",
    providers: ["openai", "azure"],
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
  assert.deepEqual(
    filterModelOptions(models, "azure").map((model) => model.id),
    ["gpt-5.5"],
  );
  assert.deepEqual(
    filterModelOptions(models, "reasoning").map((model) => model.id),
    ["gpt-5.5"],
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

test("mergeModelOptionLists retains fallbacks while live metadata wins", () => {
  const merged = mergeModelOptionLists(
    [
      [
        {
          id: "linkapi:gpt-image-2-c",
          label: "LinkAPI fallback",
          metadataStatus: "fallback",
        },
        {
          id: "linkapi:gemini-3.1-flash-image-preview",
          label: "Gemini fallback",
        },
      ],
      [
        {
          id: "linkapi:gpt-image-2-c",
          label: "LinkAPI · GPT Image 2 C",
          metadataStatus: "live",
        },
        {
          id: "nanogpt:new-image-model",
          label: "NanoGPT · New Image Model",
        },
      ],
    ],
    3,
  );

  assert.deepEqual(
    merged.map(({ id, label, metadataStatus }) => ({
      id,
      label,
      metadataStatus,
    })),
    [
      {
        id: "linkapi:gpt-image-2-c",
        label: "LinkAPI · GPT Image 2 C",
        metadataStatus: "live",
      },
      {
        id: "linkapi:gemini-3.1-flash-image-preview",
        label: "Gemini fallback",
        metadataStatus: undefined,
      },
      {
        id: "nanogpt:new-image-model",
        label: "NanoGPT · New Image Model",
        metadataStatus: undefined,
      },
    ],
  );
});

test("live AIHubMix models replace matching fallbacks without duplicates", () => {
  const modelId = "aihubmix:gpt-image-2-free";
  const merged = mergeModelOptionLists([
    MULTILLM_IMAGE_MODELS,
    [
      {
        id: modelId,
        label: "AIHubMix · GPT Image 2 Free",
        metadataStatus: "live",
      },
    ],
  ]);

  assert.equal(merged.filter((model) => model.id === modelId).length, 1);
  assert.equal(
    merged.find((model) => model.id === modelId)?.metadataStatus,
    "live",
  );
});
