import type { MultiLlmModelKind } from "./multillm-proxy";

const CHAT_WORKSPACE_CATALOG_KINDS = [
  "chat",
  "image",
  "video",
  "audio",
] as const satisfies readonly MultiLlmModelKind[];

export const refreshMultiLlmChatWorkspaceCatalogs = async (
  refreshCatalog: (kind: MultiLlmModelKind) => Promise<unknown>,
) => {
  await Promise.all(
    CHAT_WORKSPACE_CATALOG_KINDS.map((kind) => refreshCatalog(kind)),
  );
};
