import type { MultiLlmModelKind } from "./multillm-proxy";

const CHAT_WORKSPACE_CATALOG_KINDS = [
  "chat",
  "image",
  "video",
  "audio",
] as const satisfies readonly MultiLlmModelKind[];

export const coalesceMultiLlmCatalogRefreshes = (
  refreshCatalog: (kind: MultiLlmModelKind) => Promise<unknown>,
) => {
  const pendingRefreshes = new Map<MultiLlmModelKind, Promise<unknown>>();

  return (kind: MultiLlmModelKind) => {
    const pendingRefresh = pendingRefreshes.get(kind);
    if (pendingRefresh) return pendingRefresh;

    const refresh = refreshCatalog(kind).finally(() => {
      if (pendingRefreshes.get(kind) === refresh) {
        pendingRefreshes.delete(kind);
      }
    });
    pendingRefreshes.set(kind, refresh);
    return refresh;
  };
};

export const refreshMultiLlmChatWorkspaceCatalogs = async (
  refreshCatalog: (kind: MultiLlmModelKind) => Promise<unknown>,
) => {
  await Promise.all(
    CHAT_WORKSPACE_CATALOG_KINDS.map((kind) => refreshCatalog(kind)),
  );
};
