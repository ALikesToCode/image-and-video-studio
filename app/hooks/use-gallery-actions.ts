"use client";

import { type Dispatch, type SetStateAction, type RefObject } from "react";
import { clearGalleryStore, putGalleryAssets } from "@/lib/gallery-db";
import { galleryAssetBlob, mergeGalleryImport, parseGalleryBackup } from "@/lib/gallery-backup";
import type { StoredMedia } from "@/lib/types";

export function useGalleryActions({ getItems, mutate, setItems, urls, idbAvailable }: {
  getItems: () => StoredMedia[];
  mutate: <T>(operation: () => Promise<T>) => Promise<T>;
  setItems: Dispatch<SetStateAction<StoredMedia[]>>;
  urls: RefObject<Map<string, string>>;
  idbAvailable: boolean;
}) {
  const remove = async (ids: string[]) => {
    if (idbAvailable) await clearGalleryStore(ids);
    for (const id of ids) {
      const url = urls.current.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.current.delete(id);
    }
    const removed = new Set(ids);
    setItems((previous) => previous.filter((item) => !removed.has(item.id)));
  };
  const importBackup = (text: string) => mutate(async () => {
    if (!idbAvailable) throw new Error("Gallery imports require browser storage. Enable it before importing.");
      const additions = mergeGalleryImport(getItems(), parseGalleryBackup(text));
      const blobs = additions.map((item) => ({ metadata: item, blob: galleryAssetBlob(item) }));
      await putGalleryAssets(blobs);
      const restored = additions.map((item, index) => {
        const dataUrl = URL.createObjectURL(blobs[index].blob);
        urls.current.set(item.id, dataUrl);
        return { ...item, dataUrl };
      });
      setItems((previous) => [...restored, ...previous]);
      return restored.length;
  });
  return { clearGallery: () => mutate(() => remove(getItems().map((item) => item.id))), deleteSavedMedia: (id: string) => mutate(() => remove([id])), importGalleryBackup: importBackup };
}
