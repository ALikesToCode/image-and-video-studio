import type { Provider } from "@/lib/constants";

export type KeyStorageMode = "session" | "persistent" | "manual";

export type ProviderKeys = Record<Provider, string>;

export type LegacyProviderKey = {
  provider: Provider;
  key: string;
  storageKey: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PROVIDERS: Provider[] = ["gemini", "navy", "chutes", "openrouter", "nanogpt"];

export const KEY_STORAGE_MODE_KEY = "studio_key_storage_mode";
export const LEGACY_KEY_MIGRATION_DISMISSED_KEY =
  "studio_api_key_migration_dismissed";

export const LEGACY_PROVIDER_KEY_STORAGE: Record<Provider, string> = {
  gemini: "studio_api_key_gemini",
  navy: "studio_api_key_navy",
  chutes: "studio_api_key_chutes",
  openrouter: "studio_api_key_openrouter",
  nanogpt: "studio_api_key_nanogpt",
};

const SESSION_KEY_PREFIX = "studio_session_api_key_";
const PERSISTENT_KEY_PREFIX = "studio_persistent_api_key_";

const emptyProviderKeys = (): ProviderKeys => ({
  gemini: "",
  navy: "",
  chutes: "",
  openrouter: "",
  nanogpt: "",
});

const getSessionStorage = () =>
  typeof window === "undefined" ? null : window.sessionStorage;

const getLocalStorage = () =>
  typeof window === "undefined" ? null : window.localStorage;

const parseStoredString = (value: string | null) => {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return value;
  }
};

const isKeyStorageMode = (value: unknown): value is KeyStorageMode =>
  value === "session" || value === "persistent" || value === "manual";

const storageForMode = (
  mode: KeyStorageMode,
  storage?: { localStorage?: StorageLike | null; sessionStorage?: StorageLike | null }
) => {
  if (mode === "manual") return null;
  return mode === "persistent"
    ? storage?.localStorage ?? getLocalStorage()
    : storage?.sessionStorage ?? getSessionStorage();
};

const storageKeyForMode = (provider: Provider, mode: KeyStorageMode) =>
  mode === "persistent"
    ? `${PERSISTENT_KEY_PREFIX}${provider}`
    : `${SESSION_KEY_PREFIX}${provider}`;

export const readKeyStorageMode = (
  localStorage: StorageLike | null = getLocalStorage()
): KeyStorageMode => {
  const raw = parseStoredString(localStorage?.getItem(KEY_STORAGE_MODE_KEY) ?? null);
  return isKeyStorageMode(raw) ? raw : "session";
};

export const writeKeyStorageMode = (
  mode: KeyStorageMode,
  localStorage: StorageLike | null = getLocalStorage()
) => {
  localStorage?.setItem(KEY_STORAGE_MODE_KEY, JSON.stringify(mode));
};

export const readProviderKeys = (
  mode: KeyStorageMode,
  storage?: { localStorage?: StorageLike | null; sessionStorage?: StorageLike | null }
): ProviderKeys => {
  const keys = emptyProviderKeys();
  const targetStorage = storageForMode(mode, storage);
  if (!targetStorage) return keys;

  for (const provider of PROVIDERS) {
    keys[provider] = parseStoredString(
      targetStorage.getItem(storageKeyForMode(provider, mode))
    );
  }
  return keys;
};

export const persistProviderKeys = (
  mode: KeyStorageMode,
  keys: ProviderKeys,
  storage?: { localStorage?: StorageLike | null; sessionStorage?: StorageLike | null }
) => {
  const localStorage = storage?.localStorage ?? getLocalStorage();
  const sessionStorage = storage?.sessionStorage ?? getSessionStorage();

  if (mode === "manual") {
    for (const provider of PROVIDERS) {
      localStorage?.removeItem(storageKeyForMode(provider, "persistent"));
      sessionStorage?.removeItem(storageKeyForMode(provider, "session"));
    }
    return;
  }

  const targetStorage = storageForMode(mode, { localStorage, sessionStorage });
  const otherStorage = mode === "persistent" ? sessionStorage : localStorage;
  const otherMode: KeyStorageMode = mode === "persistent" ? "session" : "persistent";

  for (const provider of PROVIDERS) {
    const value = keys[provider]?.trim() ?? "";
    const targetKey = storageKeyForMode(provider, mode);
    if (value) targetStorage?.setItem(targetKey, JSON.stringify(value));
    else targetStorage?.removeItem(targetKey);
    otherStorage?.removeItem(storageKeyForMode(provider, otherMode));
  }
};

export const detectLegacyProviderKeys = (
  localStorage: StorageLike | null = getLocalStorage()
): LegacyProviderKey[] => {
  if (!localStorage) return [];
  return PROVIDERS.flatMap((provider) => {
    const storageKey = LEGACY_PROVIDER_KEY_STORAGE[provider];
    const key = parseStoredString(localStorage.getItem(storageKey)).trim();
    return key ? [{ provider, key, storageKey }] : [];
  });
};

export const removeLegacyProviderKeys = (
  localStorage: StorageLike | null = getLocalStorage()
) => {
  if (!localStorage) return;
  for (const storageKey of Object.values(LEGACY_PROVIDER_KEY_STORAGE)) {
    localStorage.removeItem(storageKey);
  }
};

export const hasDismissedLegacyKeyMigration = (
  localStorage: StorageLike | null = getLocalStorage()
) => localStorage?.getItem(LEGACY_KEY_MIGRATION_DISMISSED_KEY) === "1";

export const markLegacyKeyMigrationDismissed = (
  localStorage: StorageLike | null = getLocalStorage()
) => {
  localStorage?.setItem(LEGACY_KEY_MIGRATION_DISMISSED_KEY, "1");
};

export const clearAllProviderKeys = (
  storage?: { localStorage?: StorageLike | null; sessionStorage?: StorageLike | null }
) => {
  const localStorage = storage?.localStorage ?? getLocalStorage();
  const sessionStorage = storage?.sessionStorage ?? getSessionStorage();
  for (const provider of PROVIDERS) {
    localStorage?.removeItem(storageKeyForMode(provider, "persistent"));
    sessionStorage?.removeItem(storageKeyForMode(provider, "session"));
  }
  removeLegacyProviderKeys(localStorage);
};

export const providersWithKeys = (keys: ProviderKeys) =>
  PROVIDERS.filter((provider) => Boolean(keys[provider]?.trim()));
