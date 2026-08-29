import test from "node:test";
import assert from "node:assert/strict";

import {
  coalesceMultiLlmCatalogRefreshes,
  refreshMultiLlmChatWorkspaceCatalogs,
} from "./multillm-catalog-refresh.ts";

test("refreshes chat and every media catalog for the MultiLLM workspace", async () => {
  const refreshedKinds: string[] = [];

  await refreshMultiLlmChatWorkspaceCatalogs(async (kind) => {
    refreshedKinds.push(kind);
  });

  assert.deepEqual(refreshedKinds, ["chat", "image", "video", "audio"]);
});

test("coalesces overlapping refreshes for the same catalog kind", async () => {
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshedKinds: string[] = [];
  const refresh = coalesceMultiLlmCatalogRefreshes(async (kind) => {
    refreshedKinds.push(kind);
    await refreshGate;
    return kind;
  });

  const first = refresh("image");
  const second = refresh("image");
  const chat = refresh("chat");

  assert.equal(first, second);
  assert.notEqual(first, chat);
  assert.deepEqual(refreshedKinds, ["image", "chat"]);
  releaseRefresh();
  await Promise.all([first, second, chat]);
});

test("starts a new refresh after the previous request settles", async () => {
  let callCount = 0;
  const refresh = coalesceMultiLlmCatalogRefreshes(async () => {
    callCount += 1;
  });

  await refresh("image");
  await refresh("image");

  assert.equal(callCount, 2);
});
