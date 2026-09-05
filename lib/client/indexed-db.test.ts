import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { putStudioState } from "../studio-state-db.ts";
import { putGalleryBlob } from "../gallery-db.ts";

for (const kind of ["state", "gallery"] as const) {
  for (const outcome of ["complete", "abort"] as const) {
    test(`${kind} writes wait for transaction ${outcome} and close the database`, async (t) => {
      const request = { result: "record-id", onsuccess: () => {}, onerror: () => {} };
      const transaction = {
        error: new DOMException("Storage quota exceeded", "QuotaExceededError"),
        objectStore: () => ({ put: () => request }),
        oncomplete: () => {}, onabort: () => {}, onerror: () => {},
      };
      let closed = 0;
      const openRequest = {
        result: { transaction: () => transaction, close: () => { closed += 1; } },
        onsuccess: () => {},
      };
      const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: { open: () => { queueMicrotask(() => openRequest.onsuccess()); return openRequest; } },
      });
      t.after(() => {
        if (original) Object.defineProperty(globalThis, "indexedDB", original);
        else Reflect.deleteProperty(globalThis, "indexedDB");
      });
      let settled = false;
      const write = (kind === "state"
        ? putStudioState("settings", { theme: "dark" })
        : putGalleryBlob("record-id", new Blob(["image"])))
        .then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
      await setImmediate();
      request.onsuccess();
      await setImmediate();
      assert.equal(settled, false, "Request success is not transaction commit");
      if (outcome === "complete") transaction.oncomplete();
      else transaction.onabort();
      const error = await write;
      if (outcome === "complete") assert.equal(error, null);
      else assert.equal(error, transaction.error);
      assert.equal(closed, 1);
    });
  }
}
