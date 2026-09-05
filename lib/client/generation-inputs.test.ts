import test from "node:test";
import assert from "node:assert/strict";
import { parseOptionalSeed, snapshotGenerationReferences, videoSourceFromSnapshot } from "./generation-inputs.ts";
import type { StoredReference } from "../types.ts";

test("optional seeds preserve zero and reject blank, fractional, or unsafe values", () => {
  assert.equal(parseOptionalSeed("0"), 0);
  assert.equal(parseOptionalSeed("42"), 42);
  for (const value of [undefined, "", " ", "NaN", "Infinity", "1.5", "9007199254740992"]) {
    assert.equal(parseOptionalSeed(value), null);
  }
});

const reference = (id: string, role: StoredReference["role"] = "general"): StoredReference => ({
  id, role, dataUrl: `blob:${id}`, blobKey: `reference:${id}`, mimeType: "image/png", createdAt: "2026-09-05",
});

test("queued references keep their order and bytes after composer references change", async () => {
  const references = [reference("a"), reference("b", "source_image")];
  const snapshot = await snapshotGenerationReferences(["b", "a"], references, async (url) => `data:${url}`);
  references[1].dataUrl = "blob:replacement";
  assert.deepEqual(snapshot.map((entry) => entry.dataUrl), ["data:blob:b", "data:blob:a"]);
  assert.equal(videoSourceFromSnapshot(undefined, snapshot), "data:blob:b");
  assert.equal(videoSourceFromSnapshot("data:explicit-source", snapshot), "data:explicit-source");
});

test("missing or unreadable references fail instead of silently changing the request", async () => {
  await assert.rejects(snapshotGenerationReferences(["missing"], [], async () => ""), /no longer available/);
  await assert.rejects(snapshotGenerationReferences(["a"], [reference("a")], async () => { throw new Error("Gone"); }), /Unable to read reference a/);
});
