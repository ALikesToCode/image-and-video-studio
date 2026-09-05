"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { parseModelFavorites, toggleModelFavorite } from "@/lib/model-favorites";

const CHANGE_EVENT = "studio-model-favorites";
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
};

export function useModelFavorites(scope: string) {
  const key = `studio_model_favorites:${scope}`;
  const [error, setError] = useState<string | null>(null);
  const read = () => {
    try { return window.localStorage.getItem(key); }
    catch { return null; }
  };
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const favorites = useMemo(() => new Set(parseModelFavorites(raw)), [raw]);
  const toggle = (model: string) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(toggleModelFavorite(parseModelFavorites(read()), model)));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      setError(null);
    } catch { setError("Unable to save model favorites in this browser."); }
  };
  return { favorites, toggle, error };
}
