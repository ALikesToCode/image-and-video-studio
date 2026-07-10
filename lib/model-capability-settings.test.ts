import test from "node:test";
import assert from "node:assert/strict";

import type { ModelOption } from "./constants.ts";
import * as modelCapabilitySettings from "./model-capability-settings.ts";
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

test("cached descriptors and defaults are validated against supported control types", () => {
  const sanitizeDescriptors = (
    modelCapabilitySettings as unknown as {
      sanitizeModelParameterDescriptors?: (
        value: unknown,
      ) => NonNullable<ModelOption["dynamicParameters"]>;
    }
  ).sanitizeModelParameterDescriptors;
  const sanitizeDefaults = (
    modelCapabilitySettings as unknown as {
      sanitizeModelParameterDefaults?: (
        value: unknown,
        descriptors: NonNullable<ModelOption["dynamicParameters"]>,
      ) => NonNullable<ModelOption["parameterDefaults"]>;
    }
  ).sanitizeModelParameterDefaults;
  if (typeof sanitizeDescriptors !== "function" || typeof sanitizeDefaults !== "function") {
    assert.fail("cached model parameter sanitizers are not implemented");
  }

  const descriptors = sanitizeDescriptors({
    duration: {
      type: "select",
      options: [
        { value: "5", label: "5 seconds" },
        { value: "10", label: "10 seconds" },
        { value: { nested: true }, label: "unsafe" },
      ],
      default: "invalid",
    },
    seed: { type: "number", min: -1, max: 100, default: 200 },
    loop: { type: "switch", default: "not-a-boolean" },
    emptySelect: { type: "select", options: [{ value: null }] },
    invertedNumber: { type: "number", min: 10, max: 1, step: 0 },
    upload: { type: "file", default: "ignore" },
  });

  assert.deepEqual(descriptors, {
    duration: {
      type: "select",
      options: [
        { value: "5", label: "5 seconds" },
        { value: "10", label: "10 seconds" },
      ],
    },
    seed: { type: "number", min: -1, max: 100, default: 100 },
    loop: { type: "switch" },
    invertedNumber: { type: "number" },
  });
  assert.deepEqual(
    sanitizeDefaults(
      { duration: "10", seed: Number.POSITIVE_INFINITY, loop: "true", unknown: 1 },
      descriptors,
    ),
    { duration: "10", loop: true },
  );
});

test("model parameter preference keys isolate provider and mode collisions", () => {
  const preferenceKey = (
    modelCapabilitySettings as unknown as {
      modelParameterPreferenceKey?: (
        provider: string,
        mode: string,
        modelId: string,
      ) => string;
    }
  ).modelParameterPreferenceKey;
  const readPreference = (
    modelCapabilitySettings as unknown as {
      readModelParameterPreference?: (
        preferences: Record<string, Record<string, unknown>>,
        provider: string,
        mode: string,
        modelId: string,
      ) => Record<string, unknown>;
    }
  ).readModelParameterPreference;
  if (typeof preferenceKey !== "function" || typeof readPreference !== "function") {
    assert.fail("scoped model parameter preferences are not implemented");
  }

  const nanoImageKey = preferenceKey("nanogpt", "image", "shared/model");
  const nanoVideoKey = preferenceKey("nanogpt", "video", "shared/model");
  const navyImageKey = preferenceKey("navy", "image", "shared/model");
  assert.notEqual(nanoImageKey, nanoVideoKey);
  assert.notEqual(nanoImageKey, navyImageKey);

  assert.deepEqual(
    readPreference(
      {
        "shared/model": { duration: "legacy" },
        [nanoVideoKey]: { duration: "10" },
      },
      "nanogpt",
      "video",
      "shared/model",
    ),
    { duration: "10" },
  );
  assert.deepEqual(
    readPreference(
      { "shared/model": { duration: "legacy" } },
      "nanogpt",
      "video",
      "shared/model",
    ),
    { duration: "legacy" },
  );
  assert.deepEqual(
    readPreference(
      Object.create({ "shared/model": { duration: "inherited" } }),
      "nanogpt",
      "video",
      "shared/model",
    ),
    {},
  );
});
