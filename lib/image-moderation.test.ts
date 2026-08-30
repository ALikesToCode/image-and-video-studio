import test from "node:test";
import assert from "node:assert/strict";

import {
  applyImageModerationDefault,
  supportsLowImageModeration,
} from "./image-moderation.ts";

test("recognizes supported GPT Image models and provider variants", () => {
  for (const model of [
    "gpt-image-2",
    "gpt-image-2-2026-04-21",
    "gpt-image-1.5",
    "gpt-image-1",
    "gpt-image-1-mini",
    "aihubmix:gpt-image-2-free",
    "linkapi:gpt-image-2-c",
    "aimlapi:openai/gpt-image-2",
  ]) {
    assert.equal(supportsLowImageModeration(model), true, model);
  }
});

test("does not add moderation to unrelated image models", () => {
  for (const model of [
    "gpt-image-20",
    "dall-e-3",
    "flux",
    "nano-banana-2",
    "gemini-3.1-flash-image",
  ]) {
    assert.equal(supportsLowImageModeration(model), false, model);
  }

  const payload = { model: "flux", prompt: "A lighthouse" };
  assert.equal(applyImageModerationDefault("flux", payload), payload);
});

test("forces low moderation without mutating the source payload", () => {
  const payload = {
    model: "gpt-image-2",
    prompt: "A lighthouse",
    moderation: "auto",
  };

  assert.deepEqual(applyImageModerationDefault("gpt-image-2", payload), {
    ...payload,
    moderation: "low",
  });
  assert.equal(payload.moderation, "auto");
});
