type JanitorAiImportLocation = {
  pathname: string;
  search: string;
  hash: string;
};

export type JanitorAiImageImportRequest = {
  target: "image-generation" | "image-agent-chat";
  prompt: string;
  shouldAutoGenerate: boolean;
  replacementUrl: string;
};

export type JanitorAiImageImportEffects = {
  selectImageTab: () => void;
  setImageMode: () => void;
  setPrompt: (prompt: string) => void;
  requestGeneration: (prompt: string) => void;
  selectImageAgentChat?: () => void;
  setImageAgentChatPrompt?: (prompt: string) => void;
  replaceUrl: (url: string) => void;
};

const JANITOR_IMPORT_QUERY_KEYS = ["source", "action", "autoGenerate"];

const normalizedParam = (value: string | null) => value?.trim().toLowerCase() ?? "";

const buildReplacementUrl = (location: JanitorAiImportLocation) => {
  const url = new URL(
    `${location.pathname || "/"}${location.search || ""}${location.hash || ""}`,
    "https://studio.local"
  );

  for (const key of JANITOR_IMPORT_QUERY_KEYS) {
    url.searchParams.delete(key);
  }
  url.hash = "";

  return `${url.pathname}${url.search}`;
};

export const readJanitorAiImageImport = (
  location: JanitorAiImportLocation
): JanitorAiImageImportRequest | null => {
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(
    location.hash.startsWith("#") ? location.hash.slice(1) : location.hash
  );

  if (normalizedParam(searchParams.get("source")) !== "janitorai") return null;
  const mode = normalizedParam(searchParams.get("mode"));
  const view = normalizedParam(searchParams.get("view"));
  const action = normalizedParam(searchParams.get("action"));
  const target =
    mode === "image" && view === "image"
      ? "image-generation"
      : mode === "image-agent" && view === "image-agent" && action === "chat"
        ? "image-agent-chat"
        : null;
  if (!target) return null;

  const prompt = hashParams.get("prompt");
  if (prompt === null) return null;

  return {
    target,
    prompt,
    shouldAutoGenerate:
      target === "image-generation" &&
      (action === "generate" || searchParams.get("autoGenerate") === "1"),
    replacementUrl: buildReplacementUrl(location),
  };
};

export const consumeJanitorAiImageImport = (
  request: JanitorAiImageImportRequest,
  effects: JanitorAiImageImportEffects
) => {
  if (request.target === "image-agent-chat") {
    effects.selectImageAgentChat?.();
    effects.setImageAgentChatPrompt?.(request.prompt);
    effects.replaceUrl(request.replacementUrl);
    return;
  }

  effects.selectImageTab();
  effects.setImageMode();
  effects.setPrompt(request.prompt);
  if (request.shouldAutoGenerate) {
    effects.requestGeneration(request.prompt);
  }
  effects.replaceUrl(request.replacementUrl);
};
