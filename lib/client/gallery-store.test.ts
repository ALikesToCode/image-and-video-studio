import test from "node:test";
import assert from "node:assert/strict";
import { createGalleryStore } from "./gallery-store.ts";
import { mergeGalleryImport } from "../gallery-backup.ts";
import type { StoredMedia } from "../types.ts";

const asset = (id: string): StoredMedia => ({ id, kind: "image", provider: "multillm", model: "gguu:image", prompt: "A cup", createdAt: "2026-09-05", dataUrl: "blob:synthetic" });

test("concurrent gallery writes check capacity after the previous transaction commits", async () => {
  const store = createGalleryStore();
  store.setItems(Array.from({ length: 249 }, (_, i) => asset(`existing-${i}`)));
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const importing = store.mutate(async () => {
    const additions = mergeGalleryImport(store.getItems(), [asset("imported")]);
    await gate;
    store.setItems((previous) => [...additions, ...previous]);
  });
  const generating = store.mutate(async () => {
    const additions = mergeGalleryImport(store.getItems(), [asset("generated")]);
    store.setItems((previous) => [...additions, ...previous]);
  });
  const rejected = assert.rejects(generating, /250/);
  release(); await importing; await rejected;
  assert.equal(store.getItems().length, 250);
  assert.equal(store.getItems()[0].id, "imported");
  assert.ok(store.getItems().some((item) => item.id === "existing-0"));
});

test("a failed mutation releases the queue for subsequent changes", async () => {
  const store = createGalleryStore();
  await assert.rejects(store.mutate(async () => { throw new Error("Quota"); }), /Quota/);
  await store.mutate(async () => store.setItems([asset("recovered")]));
  assert.equal(store.getItems()[0].id, "recovered");
});
