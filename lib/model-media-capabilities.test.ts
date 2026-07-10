import test from "node:test";
import assert from "node:assert/strict";

import type { ModelOption } from "./constants.ts";
import {
  getModelReferenceLimit,
  modelAcceptsImageReferences,
  modelAcceptsSourceImage,
} from "./model-media-capabilities.ts";

test("known text-only models do not advertise image inputs", () => {
  const model: ModelOption = {
    id: "text-to-video",
    label: "Text to video",
    metadataStatus: "known",
    inputModalities: ["text"],
    supports: { video: true },
  };

  assert.equal(modelAcceptsImageReferences(model), false);
  assert.equal(modelAcceptsSourceImage(model), false);
  assert.equal(getModelReferenceLimit(model), 0);
});

test("catalog image inputs and explicit limits enable the matching controls", () => {
  const model: ModelOption = {
    id: "image-to-video",
    label: "Image to video",
    metadataStatus: "known",
    inputModalities: ["text", "image"],
    maxReferenceImages: 4,
    supports: {
      video: true,
      sourceImage: true,
      referenceImages: true,
    },
  };

  assert.equal(modelAcceptsImageReferences(model), true);
  assert.equal(modelAcceptsSourceImage(model), true);
  assert.equal(getModelReferenceLimit(model), 4);
});

test("legacy models without capability metadata preserve existing image controls", () => {
  const model: ModelOption = { id: "legacy", label: "Legacy" };

  assert.equal(modelAcceptsImageReferences(model), true);
  assert.equal(modelAcceptsSourceImage(model), true);
  assert.equal(getModelReferenceLimit(model), undefined);
});

test("explicit zero and false capabilities override modality fallbacks", () => {
  const model: ModelOption = {
    id: "no-reference",
    label: "No reference",
    inputModalities: ["text", "image"],
    maxReferenceImages: 0,
    supports: { referenceImages: false, sourceImage: false },
  };

  assert.equal(modelAcceptsImageReferences(model), false);
  assert.equal(modelAcceptsSourceImage(model), false);
  assert.equal(getModelReferenceLimit(model), 0);
});
