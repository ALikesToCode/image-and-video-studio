export const runtime = "edge";

type ModelRecord = Record<string, unknown>;
type ModelEntry = {
  id: string;
  label: string;
};

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

const VIDEO_ID_HINT =
  /video|veo|cogvideo|wan|kling|luma|sora|hunyuan|animate/i;

const labelFromRecord = (record: ModelRecord, fallbackId: string) => {
  const direct =
    getString(record.label) ||
    getString(record.name) ||
    getString(record.display_name) ||
    getString(record.displayName);
  if (direct) return direct;
  return fallbackId;
};

const classifyModel = (record: ModelRecord, id: string) => {
  const lowered = id.toLowerCase();
  const endpoint = getString(record.endpoint).toLowerCase();
  const modalities = extractModalities(record);
  const typeHint = getString(record.type).toLowerCase();
  const familyHint = getString(record.family).toLowerCase();
  const tags = toStringArray(record.tags);

  if (endpoint === "/v1/chat/completions" || endpoint === "/v1/responses") {
    return "chat";
  }
  if (endpoint === "/v1/images/generations") {
    return VIDEO_ID_HINT.test(id) ? "video" : "image";
  }
  if (endpoint === "/v1/audio/speech") {
    return "audio";
  }
  if (
    endpoint === "/v1/audio/transcriptions" ||
    endpoint === "/v1/embeddings" ||
    endpoint === "/v1/moderations"
  ) {
    return "ignore";
  }

  const isVideo =
    hasModality(modalities, "video") ||
    typeHint.includes("video") ||
    VIDEO_ID_HINT.test(lowered);
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
  return "ignore";
};

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");

  const response = await fetch("https://api.navy/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return Response.json(
      { error: "Unable to parse models response." },
      { status: 502 }
    );
  }
  if (!response.ok) {
    return Response.json(
      {
        error:
          toRecord(toRecord(data).error).message ||
          getString(toRecord(data).error) ||
          "Unable to fetch models.",
      },
      { status: response.status }
    );
  }

  const root = toRecord(data);
  const rawList = Array.isArray(root.data)
    ? root.data
    : Array.isArray(data)
      ? data
      : [];

  const buckets: Record<"chat" | "image" | "video" | "audio", ModelEntry[]> = {
    chat: [],
    image: [],
    video: [],
    audio: [],
  };
  const seen = new Set<string>();

  for (const entry of rawList) {
    const record = toRecord(entry);
    const id = getString(record.id) || getString(record.model);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const bucket = classifyModel(record, id);
    if (bucket === "ignore") continue;
    buckets[bucket].push({
      id,
      label: labelFromRecord(record, id),
    });
  }

  return Response.json(buckets);
}
