import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavyModelHealthSummary } from "../app/components/navy-model-health.tsx";

test("Navy model health summary exposes health and plan access accessibly", () => {
  const markup = renderToStaticMarkup(
    React.createElement(NavyModelHealthSummary, {
      model: {
        id: "gpt-image-2",
        label: "GPT Image 2",
        premium: true,
        requiredPlan: "pro",
      },
      health: {
        id: "gpt-image-2",
        endpoint: "/v1/images/generations",
        status: "ok",
        lastChecked: "2026-07-10T01:30:54.372Z",
        inProgress: false,
        uptimePercent: 85.7,
        checksCount: 14,
        okCount: 12,
        avgTtft: null,
        avgTotal: 14315,
      },
      error: null,
      loading: false,
      updatedAt: "2026-07-10T06:35:24.732Z",
      currentPlan: "pro",
      onRefresh: () => undefined,
    }),
  );

  assert.match(markup, /aria-label="Navy selected model health"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-label="Refresh health for GPT Image 2"/);
  assert.match(markup, /Operational/);
  assert.match(markup, /85\.7% rolling uptime/);
  assert.match(markup, /Plan: Eligible/);
  assert.match(markup, /Current plan: pro/);
});
