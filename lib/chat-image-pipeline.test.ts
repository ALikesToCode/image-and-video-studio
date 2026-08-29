import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeImageToolModelRequest,
  resolveRequestedImageModels,
  runImageModelFallbackSequence,
  runImageModelPipelineParallel,
} from "./chat-image-pipeline.ts";

test("Requested default image model uses the ordered fallback pipeline", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "flux",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Missing image model requests use the ordered fallback pipeline", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Requested image models try the selected model before ordered fallback", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "gpt-image-1.5",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["flux", "gpt-image-1.5"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Unavailable requested image models fall back to the ordered pipeline", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "missing-model",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Chat image model requests preserve the assistant-selected model", () => {
  assert.equal(
    normalizeImageToolModelRequest({
      requestedModel: "grok-imagine",
    }),
    "grok-imagine"
  );
  assert.equal(
    normalizeImageToolModelRequest({
      requestedModel: " flux ",
    }),
    "flux"
  );
  assert.equal(
    normalizeImageToolModelRequest({
      requestedModel: "",
    }),
    ""
  );
});

test("Image model fallback sequence stops after the first successful model", async () => {
  const calls: string[] = [];
  const updates: string[] = [];

  const result = await runImageModelFallbackSequence({
    models: ["gpt-image-2", "flux", "nano-banana-2"],
    runModel: async (model) => {
      calls.push(model);
      if (model === "gpt-image-2") {
        throw new Error("blocked by image safety policy");
      }
      return [`image:${model}`];
    },
    onUpdate: (update) => updates.push(`${update.model}:${update.status}`),
  });

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model, "flux");
  assert.deepEqual(result.value, ["image:flux"]);
  assert.deepEqual(result.errors.map((entry) => entry.model), ["gpt-image-2"]);
  assert.deepEqual(calls, ["gpt-image-2", "flux"]);
  assert.deepEqual(updates, [
    "gpt-image-2:running",
    "gpt-image-2:error",
    "flux:running",
    "flux:success",
  ]);
});

test("Image model fallback sequence returns all errors when every model fails", async () => {
  const result = await runImageModelFallbackSequence({
    models: ["gpt-image-2", "flux"],
    runModel: async (model) => {
      throw new Error(`${model} failed`);
    },
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.errors.map((entry) => entry.model), [
    "gpt-image-2",
    "flux",
  ]);
});

test("Image model parallel pipeline starts ordered models before waiting", async () => {
  let releaseFirstModel: () => void = () => {};
  const firstModelGate = new Promise<void>((resolve) => {
    releaseFirstModel = resolve;
  });
  const calls: string[] = [];

  const resultPromise = runImageModelPipelineParallel({
    models: ["gpt-image-2", "flux"],
    maxAttempts: 1,
    runModel: async (model) => {
      calls.push(model);
      if (model === "gpt-image-2") {
        await firstModelGate;
      }
      return [`image:${model}`];
    },
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["gpt-image-2", "flux"]);
  releaseFirstModel();

  const result = await resultPromise;
  assert.equal(result.status, "fulfilled");
  assert.deepEqual(
    result.values.map((entry) => entry.model),
    ["gpt-image-2", "flux"]
  );
  assert.deepEqual(
    result.values.flatMap((entry) => entry.value),
    ["image:gpt-image-2", "image:flux"]
  );
});

test("Image model parallel pipeline retries each failed model up to the configured tries", async () => {
  const calls: string[] = [];
  const attempts: Array<{ model: string; attempt: number; maxAttempts: number }> = [];

  const result = await runImageModelPipelineParallel({
    models: ["gpt-image-2", "flux"],
    maxAttempts: 4,
    runModel: async (model, state) => {
      attempts.push({ model, attempt: state.attempt, maxAttempts: state.maxAttempts });
      calls.push(model);
      const modelCalls = calls.filter((entry) => entry === model).length;
      if (model === "gpt-image-2" && modelCalls < 4) {
        throw new Error(`temporary failure ${modelCalls}`);
      }
      return [`image:${model}:${modelCalls}`];
    },
  });

  assert.equal(result.status, "fulfilled");
  assert.deepEqual(
    calls.filter((entry) => entry === "gpt-image-2"),
    ["gpt-image-2", "gpt-image-2", "gpt-image-2", "gpt-image-2"]
  );
  assert.deepEqual(
    calls.filter((entry) => entry === "flux"),
    ["flux"]
  );
  assert.deepEqual(
    result.values.map((entry) => entry.value),
    [["image:gpt-image-2:4"], ["image:flux:1"]]
  );
  assert.deepEqual(
    attempts.filter((entry) => entry.model === "gpt-image-2"),
    [
      { model: "gpt-image-2", attempt: 1, maxAttempts: 4 },
      { model: "gpt-image-2", attempt: 2, maxAttempts: 4 },
      { model: "gpt-image-2", attempt: 3, maxAttempts: 4 },
      { model: "gpt-image-2", attempt: 4, maxAttempts: 4 },
    ]
  );
});

test("Image model parallel pipeline stops when the failure is not retryable", async () => {
  const calls: string[] = [];

  const result = await runImageModelPipelineParallel({
    models: ["gpt-image-2"],
    maxAttempts: 4,
    runModel: async (model) => {
      calls.push(model);
      throw new Error("Invalid API key");
    },
    shouldRetry: (_model, error) =>
      error instanceof Error && error.message.includes("policy"),
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(calls, ["gpt-image-2"]);
  assert.equal(result.errors[0]?.attempts, 1);
});
