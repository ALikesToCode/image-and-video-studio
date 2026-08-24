import test from "node:test";
import assert from "node:assert/strict";

import { refreshMultiLlmChatWorkspaceCatalogs } from "./multillm-catalog-refresh.ts";

test("refreshes chat and every media catalog for the MultiLLM workspace", async () => {
  const refreshedKinds: string[] = [];

  await refreshMultiLlmChatWorkspaceCatalogs(async (kind) => {
    refreshedKinds.push(kind);
  });

  assert.deepEqual(refreshedKinds, ["chat", "image", "video", "audio"]);
});
