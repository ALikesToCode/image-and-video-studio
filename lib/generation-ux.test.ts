import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveGenerationSubmitState,
} from "./generation-ux.ts";

test("active image jobs allow another prompt to be queued", () => {
  assert.deepEqual(
    resolveGenerationSubmitState({
      prompt: "A glass observatory above the clouds",
      busy: true,
      mode: "image",
    }),
    {
      disabled: false,
      label: "Add image to queue",
      hint: "Current jobs keep running; this request will be queued.",
    }
  );
});

test("generation still requires a non-empty prompt", () => {
  assert.equal(
    resolveGenerationSubmitState({
      prompt: "   ",
      busy: true,
      mode: "video",
    }).disabled,
    true
  );
});

test("idle generation action names the selected medium", () => {
  assert.deepEqual(
    resolveGenerationSubmitState({
      prompt: "Read this sentence",
      busy: false,
      mode: "tts",
    }),
    {
      disabled: false,
      label: "Generate audio",
      hint: "Press Cmd/Ctrl+Enter to generate.",
    }
  );
});
