import type {
  ChatProvider,
  ModelOption,
  Provider,
} from "@/lib/constants";
import { isDeepSeekV4Model } from "@/lib/chat-tooling";

export const createChatId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const isAbortLikeError = (
  error: unknown,
  signal?: AbortSignal,
) =>
  signal?.aborted === true ||
  (error instanceof Error && error.name === "AbortError");

export const abortableDelay = (
  delayMs: number,
  signal?: AbortSignal,
) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const readLocalStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
};

export const writeLocalStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

export const formatCount = (value?: number | null) =>
  typeof value === "number"
    ? value.toLocaleString()
    : value === null
      ? "unknown"
      : "-";

export const formatUsageAge = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString() : null;

export const formatModelWindow = (value?: number | null) =>
  typeof value === "number"
    ? value.toLocaleString()
    : value === null
      ? "unknown"
      : "";

export const normalizeModalityList = (value?: string[] | null) =>
  (value ?? [])
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export const summarizeModalities = (value?: string[] | null) => {
  const normalized = normalizeModalityList(value);
  return normalized.length ? normalized.join(", ") : "unknown";
};

export const acceptsTextFile = (file: File) => {
  const type = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type.startsWith("text/") ||
    /\.(txt|md|markdown|csv|json|log|xml|yaml|yml)$/i.test(file.name)
  );
};

export const fileToDataUrl = async (file: File) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });

export const blobToDataUrl = async (blob: Blob) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Unable to read media output."));
    reader.readAsDataURL(blob);
  });

export const getStringArg = (
  args: Record<string, unknown>,
  keys: string[],
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
  }
  return "";
};

export const getStringOrStringArrayArg = (
  args: Record<string, unknown>,
  keys: string[],
  maxItems = 5,
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const values = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .slice(0, maxItems);
      if (values.length) return values;
    }
  }
  return undefined;
};

export const getNumberArg = (
  args: Record<string, unknown>,
  keys: string[],
) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

export const isImageToolProvider = (
  value: unknown,
): value is Provider =>
  value === "chutes" ||
  value === "navy" ||
  value === "nanogpt" ||
  value === "multillm";

export const imageEndpointForProvider = (provider: Provider) => {
  if (provider === "navy") return "/api/navy/image";
  if (provider === "nanogpt") return "/api/nanogpt/image";
  if (provider === "multillm") return "/api/multillm/image";
  return "/api/chutes/image";
};

export const imageProviderLabel = (provider: Provider) => {
  if (provider === "navy") return "NavyAI";
  if (provider === "nanogpt") return "NanoGPT";
  if (provider === "multillm") return "MultiLLM";
  return "Chutes";
};

export const modelSupportsReasoning = (
  provider: ChatProvider,
  modelId: string,
  modelOption?: ModelOption,
) =>
  (provider === "navy" ||
    provider === "nanogpt" ||
    provider === "multillm") &&
  (modelOption?.supportsReasoning === true || isDeepSeekV4Model(modelId));
