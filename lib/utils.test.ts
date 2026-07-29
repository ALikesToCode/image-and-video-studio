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

test("fetchAsDataUrl rejects unsafe URLs before fetching", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null);
  };

  try {
    await assert.rejects(
      fetchAsDataUrl("file:///home/user/image.png"),
      /not a supported image URL/
    );
    await assert.rejects(
      fetchAsDataUrl("javascript:alert(1)"),
      /not a supported image URL/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
