import test from "node:test";
import assert from "node:assert/strict";

import type { ModelOption } from "./constants.ts";
import {
  buildModelParameterPayload,
  coerceModelParameterValue,
  isModelParameterVisible,
  resolveModelParameterValues,
} from "./model-capability-settings.ts";

const videoModel: ModelOption = {
  id: "provider/video-model",
  label: "Video model",
  dynamicParameters: {
    duration: {
      type: "select",
      options: [
        { value: "5", label: "5 seconds" },
        { value: "10", label: "10 seconds" },
      ],
      default: "5",
    },
    resolution: {
      type: "select",
      options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
      ],
      default: "720p",
    },
    seed: {
      type: "number",
      min: -1,
      max: 100,
      step: 1,
      default: -1,
    },
    loop: {
      type: "switch",
      default: false,
      showWhen: { duration: "5" },
    },
    note: {
      type: "text",
      default: "",
    },
  },
  parameterDefaults: {
    duration: "10",
    resolution: "1080p",
    seed: 4,
    loop: false,
    note: "",
  },
};

test("model parameter values use catalog defaults and keep valid user choices", () => {
  assert.deepEqual(resolveModelParameterValues(videoModel), {
    duration: "10",
    resolution: "1080p",
    seed: 4,
    loop: false,
    note: "",
  });

  assert.deepEqual(
    resolveModelParameterValues(videoModel, {
      duration: "5",
      resolution: "invalid",
      seed: 200,
      loop: true,
      unknown: "drop",
    }),
    {
      duration: "5",
      resolution: "1080p",
      seed: 100,
      loop: true,
      note: "",
    },
  );
});

test("parameter coercion validates selects, booleans, numbers, and text", () => {
  assert.equal(
    coerceModelParameterValue(videoModel.dynamicParameters!.duration!, "10"),
    "10",
  );
  assert.equal(
    coerceModelParameterValue(videoModel.dynamicParameters!.duration!, "20"),
    undefined,
  );
  assert.equal(
    coerceModelParameterValue(videoModel.dynamicParameters!.loop!, "true"),
    true,
  );
  assert.equal(
    coerceModelParameterValue(videoModel.dynamicParameters!.seed!, "-20"),
    -1,
  );
  assert.equal(
    coerceModelParameterValue(videoModel.dynamicParameters!.note!, 12),
    "12",
  );
});

test("conditional parameters follow catalog showWhen rules", () => {
  const loop = videoModel.dynamicParameters!.loop!;
  assert.equal(isModelParameterVisible(loop, { duration: "5" }), true);
  assert.equal(isModelParameterVisible(loop, { duration: "10" }), false);
});

test("parameter payload includes only known visible non-empty scalar values", () => {
  assert.deepEqual(
    buildModelParameterPayload(videoModel, {
      duration: "10",
      resolution: "1080p",
      seed: 12,
      loop: true,
      note: "",
      unknown: "drop",
    }),
    {
      duration: "10",
      resolution: "1080p",
      seed: 12,
    },
  );
});
