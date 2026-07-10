import test from "node:test";
import assert from "node:assert/strict";

import {
  getNavyModelAccessSummary,
  parseNavyModelHealthResponse,
  selectLiveCatalogBucket,
} from "./navy-model-health.ts";

test("successful Navy catalog buckets replace stale fallback entries", () => {
  const live = [{ id: "current-model", label: "Current model" }];
  const fallback = [{ id: "stale-model", label: "Stale model" }];

  assert.deepEqual(selectLiveCatalogBucket(live, fallback), live);
  assert.deepEqual(selectLiveCatalogBucket([], fallback), fallback);
});

test("Navy model health parser keeps the compact selected-model response", () => {
  assert.deepEqual(
    parseNavyModelHealthResponse(
      {
        lastUpdated: "2026-07-10T06:35:24.732Z",
        models: {
          "gpt-image-2": {
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
            ignored: "not part of the client contract",
          },
        },
      },
      "gpt-image-2",
    ),
    {
      lastUpdated: "2026-07-10T06:35:24.732Z",
      model: {
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
    },
  );
});

test("Navy model health parser rejects mismatched or malformed records", () => {
  assert.equal(
    parseNavyModelHealthResponse(
      { models: { flux: { id: "different-model", status: "ok" } } },
      "flux",
    ),
    null,
  );
  assert.equal(parseNavyModelHealthResponse({ models: [] }, "flux"), null);
});

test("Navy plan access only claims eligibility when metadata proves it", () => {
  assert.deepEqual(
    getNavyModelAccessSummary(
      { id: "free-model", label: "Free model", premium: false },
      "free",
    ),
    {
      state: "eligible",
      label: "Eligible",
      detail: "No paid-plan requirement advertised.",
    },
  );
  assert.deepEqual(
    getNavyModelAccessSummary(
      {
        id: "premium-model",
        label: "Premium model",
        premium: true,
        requiredPlan: "pro",
      },
      "pro",
    ),
    {
      state: "eligible",
      label: "Eligible",
      detail: "Current plan: pro. Required plan: pro or higher.",
    },
  );
  assert.deepEqual(
    getNavyModelAccessSummary(
      {
        id: "premium-model",
        label: "Premium model",
        premium: true,
        requiredPlan: "pro",
      },
      "free",
    ),
    {
      state: "restricted",
      label: "Upgrade required",
      detail: "Current plan: free. Required plan: pro or higher.",
    },
  );
  assert.equal(
    getNavyModelAccessSummary(
      {
        id: "premium-model",
        label: "Premium model",
        premium: true,
        requiredPlan: "pro",
      },
      "team",
    ).state,
    "unknown",
  );
});
