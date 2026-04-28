import test from "node:test";
import assert from "node:assert/strict";

import {
  STATIC_MODEL_CAPABILITIES,
  filterModelCapabilities,
  mergeModelCapabilities,
} from "./index.ts";
import type { ModelCapability } from "./types.ts";

test("static capability registry exposes Gemini image editing inputs", () => {
  const geminiImageModels = filterModelCapabilities(STATIC_MODEL_CAPABILITIES, {
    provider: "gemini",
    mode: "image",
    inputModality: "image",
    outputModality: "image",
  });

  assert.ok(geminiImageModels.some((model) => model.id.includes("flash-image")));
  assert.ok(geminiImageModels.every((model) => model.supportsImageInput));
});

test("capability filtering hides models that do not support the requested mode", () => {
  const navyAudioModels = filterModelCapabilities(STATIC_MODEL_CAPABILITIES, {
    provider: "navy",
    mode: "audio",
  });

  assert.ok(navyAudioModels.length > 0);
  assert.ok(navyAudioModels.every((model) => model.modes.includes("audio")));
});

test("dynamic capability merge overrides static capability metadata", () => {
  const dynamic: ModelCapability = {
    provider: "openrouter",
    id: "google/gemini-2.5-flash-image",
    label: "Dynamic Gemini",
    modes: ["image"],
    inputModalities: ["text", "image"],
    outputModalities: ["image", "text"],
    contextWindow: null,
    maxOutputTokens: 4096,
    supportsImageOutput: true,
    metadataStatus: "known",
    planGated: true,
  };

  const merged = mergeModelCapabilities(STATIC_MODEL_CAPABILITIES, [dynamic]);
  const model = merged.find(
    (entry) =>
      entry.provider === "openrouter" &&
      entry.id === "google/gemini-2.5-flash-image"
  );

  assert.equal(model?.label, "Dynamic Gemini");
  assert.equal(model?.planGated, true);
  assert.equal(model?.contextWindow, null);
  assert.equal(model?.maxOutputTokens, 4096);
  assert.equal(model?.supportsImageOutput, true);
  assert.equal(model?.metadataStatus, "known");
  assert.deepEqual(model?.inputModalities, ["text", "image"]);
});
