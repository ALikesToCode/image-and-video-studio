export const parseModelFavorites = (raw: string | null): string[] => {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string =>
      typeof id === "string" && id.length > 0 && id.length <= 256 && !/\s/.test(id)
    ))].slice(0, 100) : [];
  } catch { return []; }
};

export const toggleModelFavorite = (favorites: readonly string[], model: string): string[] =>
  favorites.includes(model)
    ? favorites.filter((id) => id !== model)
    : parseModelFavorites(JSON.stringify([model, ...favorites]));

export const sortFavoriteModels = <T extends { id: string }>(models: readonly T[], favorites: ReadonlySet<string>): T[] =>
  [...models].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
