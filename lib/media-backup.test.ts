import test from "node:test";
import assert from "node:assert/strict";

import { mergeUnsafeMediaBackup } from "./media-backup.ts";

test("unsafe media backups retain prior records without duplicating them", () => {
  assert.deepEqual(
    mergeUnsafeMediaBackup(
      {
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        records: [{ id: "old", dataUrl: "file:///old.png" }],
      },
      [
        { id: "old", dataUrl: "file:///old.png" },
        { id: "new", dataUrl: "javascript:alert(1)" },
      ],
      "2026-07-29T00:00:00.000Z"
    ),
    {
      version: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      records: [
        { id: "old", dataUrl: "file:///old.png" },
        { id: "new", dataUrl: "javascript:alert(1)" },
      ],
    }
  );
});
