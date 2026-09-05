import test from "node:test";
import assert from "node:assert/strict";
import { exportGalleryBackup, galleryAssetBlob, mergeGalleryImport, parseGalleryBackup } from "./gallery-backup.ts";
import type { StoredMedia } from "./types.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const item: StoredMedia = { id: "test-image", kind: "image", provider: "multillm", model: "gguu:image", prompt: "A red pixel", createdAt: "2026-09-05T00:00:00.000Z", dataUrl: "blob:temporary" };

test("portable export embeds actual image bytes and preserves metadata", async () => {
  const text = await exportGalleryBackup([item], async () => PNG);
  const [restored] = parseGalleryBackup(text);
  assert.equal(restored.prompt, item.prompt);
  assert.equal(restored.id, item.id);
  assert.equal(restored.dataUrl, PNG);
  assert.ok(galleryAssetBlob(restored).size > 0);
  assert.equal(text.includes("blob:temporary"), false);
});

test("invalid backups fail before restoring any assets", () => {
  for (const value of ["bad JSON", "{}", JSON.stringify({ version: 2, assets: [] }),
    JSON.stringify({ assets: [item] }), JSON.stringify({ assets: [{ ...item, dataUrl: "https://example.com/image.png" }] }),
    JSON.stringify({ assets: [{ ...item, dataUrl: "data:text/html;base64,SGk=" }] }),
    JSON.stringify({ assets: [{ ...item, dataUrl: PNG }, { ...item, dataUrl: PNG }] })]) {
    assert.throws(() => parseGalleryBackup(value));
  }
});

test("repeated imports skip existing IDs and never evict existing gallery assets", () => {
  assert.deepEqual(mergeGalleryImport([item], [item]), []);
  assert.throws(() => mergeGalleryImport(Array.from({ length: 250 }, (_, i) => ({ ...item, id: `old-${i}` })), [item]), /250/);
});

test("a failed media read cannot produce a successful partial export", async () => {
  await assert.rejects(exportGalleryBackup([item], async () => { throw new Error("Missing image"); }), /Missing image/);
});
