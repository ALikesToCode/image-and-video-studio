import test from "node:test";
import assert from "node:assert/strict";

import {
  backupAndPruneUnsafeMediaRecords,
  partitionGeneratedImages,
  partitionStoredMediaRecords,
  unsafeMediaBackupKey,
} from "./studio-media-persistence.ts";

test("persisted gallery records reject unsafe and stale runtime URLs", () => {
  const safeRemote = {
    id: "safe-remote",
    dataUrl: "https://media.example/video.mp4",
    prompt: "Video",
    model: "veo",
    provider: "multillm" as const,
    createdAt: "2026-07-29T00:00:00.000Z",
    kind: "video" as const,
  };
  const blobBacked = {
    id: "blob-backed",
    prompt: "Image",
    model: "image",
    provider: "navy" as const,
    createdAt: "2026-07-29T00:00:00.000Z",
    kind: "image" as const,
  };
  const unsafeFile = {
    ...safeRemote,
    id: "unsafe-file",
    dataUrl: "file:///home/user/video.mp4",
  };
  const staleBlob = {
    ...safeRemote,
    id: "stale-blob",
    dataUrl: "blob:https://studio.example/stale",
  };

  assert.deepEqual(
    partitionStoredMediaRecords([
      safeRemote,
      blobBacked,
      unsafeFile,
      staleBlob,
    ]),
    {
      accepted: [safeRemote, blobBacked],
      rejected: [unsafeFile, staleBlob],
    }
  );
});

test("persisted generated images keep only safe image URLs", () => {
  const safe = {
    id: "safe",
    dataUrl: "data:image/png;base64,YWJj",
    mimeType: "image/png",
    provider: "navy" as const,
  };
  const unsafe = {
    id: "unsafe",
    dataUrl: "javascript:alert(1)",
    mimeType: "image/png",
  };

  assert.deepEqual(partitionGeneratedImages([safe, unsafe]), {
    accepted: [safe],
    rejected: [unsafe],
  });
  assert.deepEqual(partitionGeneratedImages([safe, safe, unsafe], 1), {
    accepted: [safe],
    rejected: [unsafe],
  });
});

test("unsafe persisted media is backed up before the live record is pruned", () => {
  const values = new Map<string, string>();
  const operations: string[] = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      operations.push(`set:${key}`);
      values.set(key, value);
    },
    removeItem: (key: string) => {
      operations.push(`remove:${key}`);
      values.delete(key);
    },
  };
  const key = "studio_saved_images";
  const rejected = { id: "unsafe", dataUrl: "file:///tmp/image.png" };

  assert.equal(
    backupAndPruneUnsafeMediaRecords(storage, key, {
      accepted: [],
      rejected: [rejected],
    }),
    true
  );
  assert.deepEqual(operations, [
    `set:${unsafeMediaBackupKey(key)}`,
    `remove:${key}`,
  ]);
  assert.deepEqual(
    JSON.parse(values.get(unsafeMediaBackupKey(key)) ?? "{}").records,
    [rejected]
  );
});
