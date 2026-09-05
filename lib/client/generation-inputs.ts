import type { StoredReference } from "../types.ts";

export type GenerationReference = { dataUrl: string; role?: string };

export const parseOptionalSeed = (value: string | undefined): number | null => {
  if (!value?.trim()) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed : null;
};

export const snapshotGenerationReferences = async (
  ids: readonly string[],
  references: readonly StoredReference[],
  readDataUrl: (url: string) => Promise<string>,
): Promise<GenerationReference[]> => {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  return await Promise.all(ids.map(async (id) => {
    const reference = byId.get(id);
    if (!reference) throw new Error("A selected reference is no longer available. Select it again before generating.");
    try {
      const dataUrl = reference.dataUrl.startsWith("data:")
        ? reference.dataUrl
        : await readDataUrl(reference.dataUrl);
      return { dataUrl, role: reference.role };
    } catch (cause) {
      throw new Error(`Unable to read reference ${reference.label || id}. Select it again before generating.`, { cause });
    }
  }));
};

export const videoSourceFromSnapshot = (
  sourceImage: string | undefined,
  references: readonly GenerationReference[],
): string | null => sourceImage || (
  references.find((reference) => reference.role === "source_image") ??
  references.find((reference) => reference.role === "first_frame") ??
  references[0]
)?.dataUrl || null;
