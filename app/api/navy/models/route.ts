export const runtime = "edge";

type ModelRecord = Record<string, unknown>;

const getString = (value: unknown) => (typeof value === "string" ? value : "");

const toRecord = (value: unknown): ModelRecord =>
  value && typeof value === "object" ? (value as ModelRecord) : {};

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => String(item).toLowerCase())
    : typeof value === "string"
      ? [value.toLowerCase()]
      : [];

const extractModalities = (record: ModelRecord) => {
  const direct = toStringArray(record.modalities);
  if (direct.length) return direct;
  const input = toStringArray(record.input_modalities);
  const output = toStringArray(record.output_modalities);
  return [...input, ...output];
};

const hasModality = (modalities: string[], value: string) =>
  modalities.includes(value.toLowerCase());

const classifyModel = (record: ModelRecord, id: string) => {
  const lowered = id.toLowerCase();
  const modalities = extractModalities(record);
  const typeHint = getString(record.type).toLowerCase();
  const familyHint = getString(record.family).toLowerCase();
  const tags = toStringArray(record.tags);

  const isVideo =
    hasModality(modalities, "video") ||
    typeHint.includes("video") ||
    /video|veo|cogvideo/.test(lowered);
  const isAudio =
    hasModality(modalities, "audio") ||
    typeHint.includes("audio") ||
    /tts|speech|voice/.test(lowered) ||
    tags.includes("audio");
  const isImage =
    hasModality(modalities, "image") ||
    typeHint.includes("image") ||
    familyHint.includes("image") ||
    /image|dall-e|dalle|flux|schnell|sd|stable/.test(lowered) ||
    tags.includes("image");

  if (isVideo) return "video";
  if (isImage) return "image";
  if (isAudio) return "audio";
  return "chat";
};

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");
  if (!apiKey) {
    return Response.json({ error: "Missing API key." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Unable to fetch models." },
      { status: response.status }
    );
  }

  const rawList = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
      ? data
      : [];

  const buckets: Record<string, { id: string }[]> = {
    chat: [],
    image: [],
    video: [],
    audio: [],
  };

  for (const entry of rawList) {
    const record = toRecord(entry);
    const id = getString(record.id) || getString(record.model);
    if (!id) continue;
    const bucket = classifyModel(record, id);
    buckets[bucket].push({ id });
  }

  return Response.json(buckets);
}
