import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelParameterSettings } from "../app/components/model-parameter-settings.tsx";
import type { ModelOption } from "./constants.ts";

const model: ModelOption = {
  id: "dynamic-video",
  label: "Dynamic video",
  dynamicParameters: {
    quality: {
      type: "select",
      label: "Render quality",
      placeholder: "Choose quality",
      options: [
        { value: "fast", label: "Fast" },
        { value: "standard", label: "Standard" },
      ],
    },
    loop: {
      type: "switch",
      description: "Repeat the completed clip.",
      showWhen: { quality: "standard" },
    },
    duration: {
      type: "number",
      label: "Duration",
      description: "Length in seconds.",
      placeholder: "Seconds",
      min: 1,
      max: 10,
      step: 1,
    },
    note: {
      type: "string",
      placeholder: "Optional note",
    },
  },
};

test("renders accessible controls for visible dynamic model parameters", () => {
  const markup = renderToStaticMarkup(
    createElement(ModelParameterSettings, {
      model,
      values: {
        quality: "standard",
        loop: true,
        duration: 6,
        note: "Keep the camera steady",
      },
      onValueChange: () => undefined,
    }),
  );

  assert.match(markup, />Render quality</);
  assert.match(markup, /role="switch"/);
  assert.match(markup, /checked=""/);
  assert.match(markup, />Repeat the completed clip\.</);
  assert.match(markup, /type="number"/);
  assert.match(markup, /min="1"/);
  assert.match(markup, /max="10"/);
  assert.match(markup, /step="1"/);
  assert.match(markup, /placeholder="Seconds"/);
  assert.match(markup, /placeholder="Optional note"/);
  assert.match(markup, />Note</);
});

test("omits parameters whose showWhen conditions are not met", () => {
  const markup = renderToStaticMarkup(
    createElement(ModelParameterSettings, {
      model,
      values: { quality: "fast", loop: true, duration: 4, note: "" },
      onValueChange: () => undefined,
    }),
  );

  assert.doesNotMatch(markup, /Repeat the completed clip/);
  assert.doesNotMatch(markup, /role="switch"/);
  assert.match(markup, />Duration</);
});
