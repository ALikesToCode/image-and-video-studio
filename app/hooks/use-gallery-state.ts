"use client";

import { useState, useSyncExternalStore } from "react";
import { createGalleryStore } from "@/lib/client/gallery-store";

export function useGalleryState() {
  const [store] = useState(createGalleryStore);
  const items = useSyncExternalStore(store.subscribe, store.getItems, store.getItems);
  return { items, ...store };
}
