export const NAVY_MEDIA_HOSTS = [
  "api.navy",
  ".api.navy",
  "api.together.ai",
  "replicate.delivery",
  ".replicate.delivery",
  ".blob.core.windows.net",
  "storage.googleapis.com",
  ".storage.googleapis.com",
  ".googleusercontent.com",
];

export const shouldAttachNavyAuth = (url: URL) =>
  url.hostname === "api.navy" || url.hostname.endsWith(".api.navy");
