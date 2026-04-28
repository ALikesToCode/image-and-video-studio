type JanitorAiImportLocation = {
  pathname: string;
  search: string;
  hash: string;
};

export type JanitorAiImageImportRequest = {
  prompt: string;
  shouldAutoGenerate: boolean;
  replacementUrl: string;
};

export type JanitorAiImageImportEffects = {
  selectImageTab: () => void;
  setImageMode: () => void;
  setPrompt: (prompt: string) => void;
  requestGeneration: (prompt: string) => void;
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
  if (normalizedParam(searchParams.get("mode")) !== "image") return null;
  if (normalizedParam(searchParams.get("view")) !== "image") return null;

  const prompt = hashParams.get("prompt");
  if (prompt === null) return null;

  return {
    prompt,
    shouldAutoGenerate:
      normalizedParam(searchParams.get("action")) === "generate" ||
      searchParams.get("autoGenerate") === "1",
    replacementUrl: buildReplacementUrl(location),
  };
};

export const consumeJanitorAiImageImport = (
  request: JanitorAiImageImportRequest,
  effects: JanitorAiImageImportEffects
) => {
  effects.selectImageTab();
  effects.setImageMode();
  effects.setPrompt(request.prompt);
  if (request.shouldAutoGenerate) {
    effects.requestGeneration(request.prompt);
  }
  effects.replaceUrl(request.replacementUrl);
};
