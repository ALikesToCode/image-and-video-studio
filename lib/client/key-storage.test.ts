import test from "node:test";
import assert from "node:assert/strict";

import {
  clearAllProviderKeys,
  detectLegacyProviderKeys,
  persistProviderKeys,
  readKeyStorageMode,
  readProviderKeys,
  removeLegacyProviderKeys,
  writeKeyStorageMode,
  type ProviderKeys,
} from "./key-storage.ts";

const createStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    has: (key: string) => data.has(key),
  };
};

const keys = (overrides: Partial<ProviderKeys> = {}): ProviderKeys => ({
  gemini: "",
  navy: "",
  chutes: "",
  openrouter: "",
  ...overrides,
});

test("key storage defaults to session mode", () => {
  const localStorage = createStorage();

  assert.equal(readKeyStorageMode(localStorage), "session");
  writeKeyStorageMode("persistent", localStorage);
  assert.equal(readKeyStorageMode(localStorage), "persistent");
});

test("session mode stores keys in sessionStorage and clears persistent copies", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();

  persistProviderKeys("persistent", keys({ gemini: "old" }), {
    localStorage,
    sessionStorage,
  });
  persistProviderKeys("session", keys({ gemini: "session-key" }), {
    localStorage,
    sessionStorage,
  });

  assert.equal(
    readProviderKeys("session", { localStorage, sessionStorage }).gemini,
    "session-key"
  );
  assert.equal(
    readProviderKeys("persistent", { localStorage, sessionStorage }).gemini,
    ""
  );
});

test("manual mode clears session and persistent key storage", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();

  persistProviderKeys("session", keys({ navy: "session-navy" }), {
    localStorage,
    sessionStorage,
  });
  persistProviderKeys("persistent", keys({ gemini: "persistent-gemini" }), {
    localStorage,
    sessionStorage,
  });
  persistProviderKeys("manual", keys({ gemini: "memory-only", navy: "memory-only" }), {
    localStorage,
    sessionStorage,
  });

  assert.deepEqual(readProviderKeys("session", { localStorage, sessionStorage }), keys());
  assert.deepEqual(readProviderKeys("persistent", { localStorage, sessionStorage }), keys());
});

test("legacy localStorage API keys are detected and explicitly removable", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  localStorage.setItem("studio_api_key_gemini", JSON.stringify("legacy-gemini"));
  localStorage.setItem("studio_api_key_navy", "legacy-navy");

  assert.deepEqual(
    detectLegacyProviderKeys(localStorage).map((entry) => [entry.provider, entry.key]),
    [
      ["gemini", "legacy-gemini"],
      ["navy", "legacy-navy"],
    ]
  );

  clearAllProviderKeys({ localStorage, sessionStorage });
  assert.deepEqual(detectLegacyProviderKeys(localStorage), []);
});

test("removeLegacyProviderKeys does not remove new persistent keys", () => {
  const localStorage = createStorage();

  persistProviderKeys("persistent", keys({ openrouter: "new-key" }), {
    localStorage,
    sessionStorage: createStorage(),
  });
  localStorage.setItem("studio_api_key_openrouter", JSON.stringify("legacy"));
  removeLegacyProviderKeys(localStorage);

  assert.equal(readProviderKeys("persistent", { localStorage }).openrouter, "new-key");
  assert.equal(localStorage.has("studio_api_key_openrouter"), false);
});
