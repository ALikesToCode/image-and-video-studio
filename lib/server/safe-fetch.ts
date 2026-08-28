import { readBoundedMediaBody } from "./media-response";

export type SafeFetchOptions = {
  allowedHosts: string[];
  allowedContentTypes: string[];
  maxBytes: number;
  timeoutMs: number;
  headers?: HeadersInit;
  allowRedirects?: boolean;
};

const MAX_REDIRECTS = 3;
const CROSS_ORIGIN_SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
  "x-user-api-key",
] as const;

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
  const firstHextet = Number.parseInt(normalized.split(":")[0] ?? "", 16);
  const mappedIpv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(
    normalized
  );
  if (mappedIpv4) {
    const high = Number.parseInt(mappedIpv4[1], 16);
    const low = Number.parseInt(mappedIpv4[2], 16);
    const value = high * 65_536 + low;
    const ipv4 = [
      Math.floor(value / 16_777_216) % 256,
      Math.floor(value / 65_536) % 256,
      Math.floor(value / 256) % 256,
      value % 256,
    ].join(".");
    return isPrivateOrLocalIpv4(ipv4);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    (Number.isFinite(firstHextet) &&
      ((firstHextet & 0xfe00) === 0xfc00 ||
        (firstHextet & 0xffc0) === 0xfe80 ||
        (firstHextet & 0xffc0) === 0xfec0 ||
        (firstHextet & 0xff00) === 0xff00))
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

export async function safeFetchExternalMedia(
  url: string,
  options: SafeFetchOptions
): Promise<Response> {
  let currentUrl = validateExternalMediaUrl(url, options.allowedHosts);
  const requestHeaders = new Headers(options.headers);
  let redirects = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(currentUrl.toString(), {
        headers: requestHeaders,
        redirect: "manual",
        signal: controller.signal,
      });

      const isRedirect =
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location");
      if (isRedirect) {
        if (!options.allowRedirects || redirects >= MAX_REDIRECTS) {
          throw new Error("Media URL redirect is not allowed.");
        }
        const location = response.headers.get("location");
        const nextUrl = validateExternalMediaUrl(
          new URL(location ?? "", currentUrl).toString(),
          options.allowedHosts
        );
        if (nextUrl.origin !== currentUrl.origin) {
          for (const header of CROSS_ORIGIN_SENSITIVE_HEADERS) {
            requestHeaders.delete(header);
          }
        }
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }

      if (!response.ok) {
        throw new Error("Unable to download media.");
      }

      const { bytes: body, contentType } = await readBoundedMediaBody(response, {
        allowedContentTypes: options.allowedContentTypes,
        maxBytes: options.maxBytes,
      });
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Content-Length", String(body.byteLength));
      const responseBody = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength
      ) as ArrayBuffer;
      return new Response(responseBody, {
        status: 200,
        headers,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Media download timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
