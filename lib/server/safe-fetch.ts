export type SafeFetchOptions = {
  allowedHosts: string[];
  allowedContentTypes: string[];
  maxBytes: number;
  timeoutMs: number;
  headers?: HeadersInit;
  allowRedirects?: boolean;
};

const MAX_REDIRECTS = 3;

const normalizeHost = (host: string) => host.toLowerCase().replace(/\.$/, "");

const isAllowedHost = (host: string, allowedHosts: string[]) => {
  const normalizedHost = normalizeHost(host);
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowed = normalizeHost(allowedHost);
    if (normalizedAllowed.startsWith("*.")) {
      const suffix = normalizedAllowed.slice(1);
      return normalizedHost.endsWith(suffix);
    }
    if (normalizedAllowed.startsWith(".")) {
      return normalizedHost.endsWith(normalizedAllowed);
    }
    return normalizedHost === normalizedAllowed;
  });
};

const isPrivateOrLocalIpv4 = (host: string) => {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const isPrivateOrLocalIpv6 = (host: string) => {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
};

const isPrivateOrLocalHost = (host: string) => {
  const normalized = normalizeHost(host.replace(/^\[|\]$/g, ""));
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    isPrivateOrLocalIpv4(normalized) ||
    isPrivateOrLocalIpv6(normalized)
  );
};

export const validateExternalMediaUrl = (
  value: string,
  allowedHosts: string[]
) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid media URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Media URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Media URL credentials are not allowed.");
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    throw new Error("Local or private media URLs are not allowed.");
  }
  if (!isAllowedHost(url.hostname, allowedHosts)) {
    throw new Error("Media URL host is not allowed.");
  }

  return url;
};

const isAllowedContentType = (
  contentType: string | null,
  allowedContentTypes: string[]
) => {
  const normalized = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return allowedContentTypes.some((allowed) =>
    normalized.startsWith(allowed.toLowerCase())
  );
};

const readBoundedBody = async (response: Response, maxBytes: number) => {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("Media response is too large.");
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Media response is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export async function safeFetchExternalMedia(
  url: string,
  options: SafeFetchOptions
): Promise<Response> {
  let currentUrl = validateExternalMediaUrl(url, options.allowedHosts);
  let redirects = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl.toString(), {
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const isRedirect =
      response.status >= 300 && response.status < 400 && response.headers.has("location");
    if (isRedirect) {
      if (!options.allowRedirects || redirects >= MAX_REDIRECTS) {
        throw new Error("Media URL redirect is not allowed.");
      }
      const location = response.headers.get("location");
      currentUrl = validateExternalMediaUrl(
        new URL(location ?? "", currentUrl).toString(),
        options.allowedHosts
      );
      redirects += 1;
      continue;
    }

    if (!response.ok) {
      throw new Error("Unable to download media.");
    }

    if (
      !isAllowedContentType(
        response.headers.get("content-type"),
        options.allowedContentTypes
      )
    ) {
      throw new Error("Unexpected media content type.");
    }

    const body = await readBoundedBody(response, options.maxBytes);
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(body.byteLength));
    return new Response(body, {
      status: 200,
      headers,
    });
  }
}
