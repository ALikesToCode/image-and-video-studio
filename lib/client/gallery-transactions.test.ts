import test from "node:test";
import assert from "node:assert/strict";
import { clearGalleryStore, putGalleryAssets } from "../gallery-db.ts";

for (const outcome of ["complete", "abort"] as const) {
  test(`gallery clearing preserves reference blobs and waits for ${outcome}`, async (t) => {
    const deletes: Array<[string, string]> = [];
    const tombstones: unknown[] = [];
    let openedStores: string[] = [];
    let closes = 0;
    const transaction = {
      oncomplete: () => {}, onabort: () => {}, onerror: () => {},
      error: new Error("Storage failed"),
      objectStore: (name: string) => ({ delete: (id: string) => { deletes.push([name, id]); }, put: (value: unknown) => { tombstones.push(value); } }),
    };
    const request = { onsuccess: () => {}, result: {
      close: () => { closes++; },
      transaction: (stores: string[]) => {
        openedStores = stores;
        queueMicrotask(() => outcome === "complete" ? transaction.oncomplete() : transaction.onabort());
        return transaction;
      },
    } };
    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
      open: () => { queueMicrotask(() => request.onsuccess()); return request; },
    } });
    t.after(() => original ? Object.defineProperty(globalThis, "indexedDB", original) : Reflect.deleteProperty(globalThis, "indexedDB"));
    const cleared = clearGalleryStore(["gallery-image", "reference:character"]);
    if (outcome === "complete") await cleared;
    else await assert.rejects(cleared, /Storage failed/);
    assert.deepEqual(openedStores, ["assetBlobs", "images", "assets"]);
    assert.deepEqual(deletes, [["assetBlobs", "gallery-image"], ["images", "gallery-image"]]);
    assert.deepEqual(tombstones, [{ id: "gallery-image", deleted: true }]);
    assert.equal(closes, 1);
  });
}

test("empty gallery changes do not open or clear shared storage", async () => {
  await clearGalleryStore([]);
  await clearGalleryStore(["reference:kept"]);
  await putGalleryAssets([]);
});
