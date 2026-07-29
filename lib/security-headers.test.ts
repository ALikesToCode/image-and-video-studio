import test from "node:test";
import assert from "node:assert/strict";

import nextConfig, {
  createContentSecurityPolicy,
  createSecurityHeaders,
} from "../next.config.ts";

test("production security headers exclude development-only script execution", () => {
  const policy = createContentSecurityPolicy(false);

  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /\bfile:/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.match(policy, /frame-ancestors 'none'/);

  const headers = createSecurityHeaders(false);
  assert.equal(
    headers.find(({ key }) => key === "X-Frame-Options")?.value,
    "DENY"
  );
  assert.equal(
    headers.find(({ key }) => key === "Strict-Transport-Security")?.value,
    "max-age=31536000; includeSubDomains"
  );
  assert.equal(nextConfig.poweredByHeader, false);
});

test("development security headers retain the Next.js evaluator without HSTS", () => {
  const policy = createContentSecurityPolicy(true);

  assert.match(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  assert.equal(
    createSecurityHeaders(true).some(
      ({ key }) => key === "Strict-Transport-Security"
    ),
    false
  );
});
