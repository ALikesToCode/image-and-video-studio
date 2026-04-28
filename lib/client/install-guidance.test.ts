import test from "node:test";
import assert from "node:assert/strict";

import {
  getInstallGuidance,
  shouldShowInstallEntryPoint,
} from "./install-guidance.ts";

test("install entry point is hidden only when app is already standalone", () => {
  assert.equal(shouldShowInstallEntryPoint(false), true);
  assert.equal(shouldShowInstallEntryPoint(true), false);
});

test("install guidance gives iOS users add-to-home-screen instructions", () => {
  const guidance = getInstallGuidance(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  );

  assert.equal(guidance.platform, "ios");
  assert.match(guidance.steps.join(" "), /Share/i);
  assert.match(guidance.steps.join(" "), /Add to Home Screen/i);
});

test("install guidance prefers Chrome install prompt when available", () => {
  const guidance = getInstallGuidance(
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    true
  );

  assert.equal(guidance.platform, "android-chrome");
  assert.match(guidance.primaryAction, /Install app/i);
  assert.match(guidance.steps[0], /Tap Install app/i);
});
