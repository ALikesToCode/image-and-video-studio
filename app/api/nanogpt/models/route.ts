import { providerErrorDetails } from "@/lib/api-safety";
import {
  normalizeNanoGptImageModels,
  normalizeNanoGptVideoModels,
} from "@/lib/nanogpt-media";

const CATALOG_URLS = {
  image: "https://nano-gpt.com/api/v1/images/models",
  video: "https://nano-gpt.com/api/v1/video-models",
} as const;

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get("mode");
  if (mode !== "image" && mode !== "video") {
    return Response.json(
      { error: "NanoGPT model mode must be image or video." },
      { status: 400 },
    );
  }

  const response = await fetch(CATALOG_URLS[mode], {
    headers: { Accept: "application/json" },
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return Response.json(
      { error: "Unable to parse NanoGPT model catalog." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return Response.json(
      providerErrorDetails(
        payload,
        "Unable to fetch NanoGPT model catalog.",
        { response },
      ),
      { status: response.status },
    );
  }

  const models =
    mode === "image"
      ? normalizeNanoGptImageModels(payload)
      : normalizeNanoGptVideoModels(payload);
  const root = asRecord(payload);

  return Response.json(
    {
      mode,
      models,
      ...(root?.meta && typeof root.meta === "object" ? { meta: root.meta } : {}),
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
