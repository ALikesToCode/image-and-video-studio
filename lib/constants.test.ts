import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MODELS,
  DEFAULT_MULTILLM_IMAGE_MODEL_ID,
  MULTILLM_IMAGE_MODELS,
} from "./constants.ts";

test("defaults new MultiLLM image sessions to the free GPT Image route", () => {
  assert.equal(
    DEFAULT_MULTILLM_IMAGE_MODEL_ID,
    "aihubmix:gpt-image-2-free",
  );
  assert.ok(
    MULTILLM_IMAGE_MODELS.some(
      (model) => model.id === DEFAULT_MULTILLM_IMAGE_MODEL_ID,
    ),
  );
  assert.equal(
    DEFAULT_MODELS.multillm.image,
    DEFAULT_MULTILLM_IMAGE_MODEL_ID,
  );
});
