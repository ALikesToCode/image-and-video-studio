export const mediaExtensionFromMimeType = (
  mimeType: string | null | undefined,
  kind: "image" | "video" | "audio"
) => {
  const normalized = (mimeType ?? "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("avif")) return "avif";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg")) return kind === "audio" ? "mp3" : "mp4";
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("aac")) return "aac";
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("wav")) return "wav";
  if (kind === "video") return "mp4";
  if (kind === "audio") return "mp3";
  return "png";
};
