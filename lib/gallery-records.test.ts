import test from "node:test";
import assert from "node:assert/strict";
import { mergeDurableGalleryRecords } from "./gallery-records.ts";
import type { StoredMediaRecord } from "./studio-media-persistence.ts";

const asset: StoredMediaRecord = { id: "saved", provider: "multillm", model: "gguu:image", prompt: "A blue cup", kind: "image", createdAt: "2026-09-05T00:00:00.000Z" };

test("durable gallery metadata restores imports even when localStorage is unavailable", () => {
  assert.deepEqual(mergeDurableGalleryRecords([], [asset]), [asset]);
});

test("deletion tombstones override stale localStorage URLs after a failed metadata write", () => {
  assert.deepEqual(mergeDurableGalleryRecords([{ ...asset, dataUrl: "https://example.com/image.png" }], [{ id: "saved", deleted: true }]), []);
});

test("durable records take precedence and malformed records are ignored", () => {
  assert.deepEqual(mergeDurableGalleryRecords([asset], [{ ...asset, prompt: "Restored prompt" }, { id: "unsafe", dataUrl: "javascript:alert(1)" }]).map((item) => item.prompt), ["Restored prompt"]);
});

test("missing metadata cannot abort hydration of valid gallery records", () => {
  assert.deepEqual(mergeDurableGalleryRecords([], [{ id: "bad" }, { id: "incomplete", createdAt: "2026-09-05" }, asset]), [asset]);
});
