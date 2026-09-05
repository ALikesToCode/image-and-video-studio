import type { StoredMedia } from "../types.ts";

export const createGalleryStore = () => {
  let items: StoredMedia[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const getItems = () => items;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const setItems = (update: StoredMedia[] | ((previous: StoredMedia[]) => StoredMedia[])) => {
    items = typeof update === "function" ? update(items) : update;
    for (const listener of listeners) listener();
  };
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  return { getItems, subscribe, setItems, mutate };
};
