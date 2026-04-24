import test from "node:test";
import assert from "node:assert/strict";

import { fetchAsDataUrl } from "./utils.ts";

test("fetchAsDataUrl returns existing data URLs without fetching", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null);
  };

  try {
    const dataUrl = " data:image/jpeg;base64,abcd ";
    assert.equal(await fetchAsDataUrl(dataUrl), dataUrl.trim());
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
