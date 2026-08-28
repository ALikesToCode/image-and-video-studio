import { readJsonResponse } from "./server/json-body.ts";

const LABELED_SECRET_PATTERNS = [
  /authorization["']?\s*[:=]\s*["']?(?:(?:[A-Za-z][A-Za-z0-9._-]*)\s+[A-Za-z0-9%._~+/=:-]+|(?![A-Za-z][A-Za-z0-9._-]*\s)[A-Za-z0-9%._~+/=:-]+)/gi,
  /x-api-key["']?\s*[:=]\s*["']?[A-Za-z0-9%._~+/=:-]+/gi,
  /(?:access|refresh)[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9%._~+/=:-]+/gi,
  /client[_-]?secret["']?\s*[:=]\s*["']?[A-Za-z0-9%._~+/=:-]+/gi,
  /password["']?\s*[:=]\s*["']?[^\s,;}"']+/gi,
  /Bearer\s+[A-Za-z0-9%._~+/=:-]+/gi,
  /x-goog-api-key["':\s]+[A-Za-z0-9%._~+/=:-]+/gi,
  /api[_-]?key["':\s]+[A-Za-z0-9%._~+/=:-]+/gi,
];

const UNLABELED_SECRET_PATTERNS = [/Key\s+[A-Za-z0-9%._~+/=:-]+/gi];

const MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const SAFE_PARAMETER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,159}$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const CORS_ALLOW_HEADERS =
  "content-type, x-user-api-key, authorization, x-janitorai-source, x-janitorai-agent";

const authorizationBearer = (req: Request) => {
  const authorization = req.headers.get("authorization")?.trim();
  if (!authorization) return "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
};

export const getUserApiKey = (
  req: Request,
  body?: Record<string, unknown> | null
) => {
  const headerKey = req.headers.get("x-user-api-key")?.trim();
  if (headerKey) return headerKey;
  const bearerKey = authorizationBearer(req);
  if (bearerKey) return bearerKey;
  const bodyKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  return bodyKey;
};

export const isJanitorAiUserscriptRequest = (
  req: Request,
  body?: Record<string, unknown> | null
) => {
  const sourceHeader = req.headers.get("x-janitorai-source")?.trim();
  if (sourceHeader?.toLowerCase() === "userscript") return true;
  return (
    typeof body?.source === "string" &&
    body.source.toLowerCase() === "janitorai"
  );
};

const allowedJanitorAiCorsOrigin = (origin: string) => {
  const normalizedOrigin = origin.trim().toLowerCase();
  if (normalizedOrigin === "https://janitorai.com") {
    return "https://janitorai.com";
  }
  if (normalizedOrigin === "https://www.janitorai.com") {
    return "https://www.janitorai.com";
  }
  if (normalizedOrigin === "https://chat.janitorai.com") {
    return "https://chat.janitorai.com";
  }
  return null;
};

export const isAllowedJanitorAiCorsOrigin = (origin: string) =>
  allowedJanitorAiCorsOrigin(origin) !== null;

export const janitorAiCorsHeaders = (
  req: Request,
  allowedMethods = "GET, POST, OPTIONS"
) => {
  const headers = new Headers({
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    Vary: "Origin",
  });
  const origin = req.headers.get("origin");
  const allowedOrigin = origin ? allowedJanitorAiCorsOrigin(origin) : null;
  if (allowedOrigin) {
    // The normalizer returns one of three literal trusted origins or null.
    headers.set("Access-Control-Allow-Origin", allowedOrigin); // nosemgrep: javascript.express.security.cors-misconfiguration.cors-misconfiguration
  }
  return headers;
};

export const janitorAiOptionsResponse = (
  req: Request,
  allowedMethods?: string
) =>
  new Response(null, {
    status: 204,
    headers: janitorAiCorsHeaders(req, allowedMethods),
  });

export const janitorAiJsonResponse = (
  req: Request,
  payload: unknown,
  init: ResponseInit = {}
) => {
  const headers = janitorAiCorsHeaders(req);
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return Response.json(payload, { ...init, headers });
};

export const redactSecrets = (value: unknown, knownSecrets: string[] = []) => {
  let text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : JSON.stringify(value ?? "");

  for (const secret of knownSecrets) {
    if (!secret) continue;
    text = text.split(secret).join("[redacted]");
  }

  for (const pattern of LABELED_SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }

  for (const pattern of UNLABELED_SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }

  return text;
};

export const providerErrorMessage = (
  payload: unknown,
  fallback: string,
  knownSecrets: string[] = []
) => {
  const root = toRecord(payload);
  const error = root?.error;
  const errorRecord = toRecord(error);
  const errorDetails = toRecord(errorRecord?.details);
  const errorDetail = toRecord(errorRecord?.detail);
  const rootDetail = toRecord(root?.detail);
  const raw =
    typeof errorRecord?.message === "string"
      ? errorRecord.message
      : typeof error === "string"
        ? error
        : typeof root?.message === "string"
          ? root.message
          : typeof errorDetails?.message === "string"
            ? errorDetails.message
            : typeof errorDetail?.message === "string"
              ? errorDetail.message
              : typeof root?.detail === "string"
                ? root.detail
                : typeof rootDetail?.message === "string"
                  ? rootDetail.message
                  : typeof root?.error_description === "string"
                    ? root.error_description
                    : typeof payload === "string"
                      ? payload
          : fallback;
  const redacted = redactSecrets(raw, knownSecrets).trim();
  return redacted || fallback;
};

type ProviderErrorDetailsOptions = {
  knownSecrets?: string[];
  response?: Response;
};

export type ProviderErrorDetails = {
  error: string;
  code?: string;
  parameter?: string;
  requestId?: string;
  retryAfterMs?: number;
  guidance?: string;
};

const firstString = (...values: unknown[]) =>
  values.find(
    (value): value is string => typeof value === "string" && Boolean(value.trim())
  )?.trim();

const safeStructuredIdentifier = (
  value: unknown,
  pattern: RegExp,
  knownSecrets: string[]
) => {
  if (typeof value !== "string") return undefined;
  const redacted = redactSecrets(value, knownSecrets).trim();
  return pattern.test(redacted) ? redacted : undefined;
};

const firstSafeStructuredIdentifier = (
  values: unknown[],
  pattern: RegExp,
  knownSecrets: string[],
) => {
  for (const value of values) {
    const safeValue = safeStructuredIdentifier(value, pattern, knownSecrets);
    if (safeValue) return safeValue;
  }
  return undefined;
};

const boundedRetryDelay = (value: unknown, multiplier: number) => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(numeric * multiplier));
};

const firstBoundedRetryDelay = (values: unknown[], multiplier: number) => {
  for (const value of values) {
    const delay = boundedRetryDelay(value, multiplier);
    if (delay !== undefined) return delay;
  }
  return undefined;
};

const retryAfterHeaderMs = (response?: Response) => {
  const value = response?.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return boundedRetryDelay(value, 1_000);
  if (!HTTP_DATE_PATTERN.test(value)) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - Date.now()));
};

const payloadRetryAfterMs = (
  root: Record<string, unknown> | null,
  error: Record<string, unknown> | null
) => {
  const millisecondsDelay = firstBoundedRetryDelay(
    [
      error?.retryAfterMs,
      error?.retry_after_ms,
      root?.retryAfterMs,
      root?.retry_after_ms,
    ],
    1,
  );
  if (millisecondsDelay !== undefined) return millisecondsDelay;
  return firstBoundedRetryDelay(
    [
      error?.retryAfter,
      error?.retry_after,
      root?.retryAfter,
      root?.retry_after,
    ],
    1_000
  );
};

export const providerErrorDetails = (
  payload: unknown,
  fallback: string,
  options: ProviderErrorDetailsOptions = {}
): ProviderErrorDetails => {
  const knownSecrets = options.knownSecrets ?? [];
  const root = toRecord(payload);
  const errorRecord = toRecord(root?.error);
  const errorDetails = toRecord(errorRecord?.details);
  const errorDetail = toRecord(errorRecord?.detail);
  const errorMetadata = toRecord(errorRecord?.metadata);
  const rootDetail = toRecord(root?.detail);
  const code = firstSafeStructuredIdentifier(
    [
      errorRecord?.code,
      errorDetails?.code,
      errorDetail?.code,
      errorMetadata?.provider_code,
      errorMetadata?.error_type,
      rootDetail?.code,
      root?.code,
      errorRecord?.type,
      root?.type,
    ],
    SAFE_CODE_PATTERN,
    knownSecrets,
  );
  const parameter = firstSafeStructuredIdentifier(
    [
      errorRecord?.param,
      errorRecord?.parameter,
      errorDetails?.param,
      errorDetails?.parameter,
      errorDetail?.param,
      errorDetail?.parameter,
      rootDetail?.param,
      rootDetail?.parameter,
      root?.param,
      root?.parameter,
    ],
    SAFE_PARAMETER_PATTERN,
    knownSecrets,
  );
  const requestId = firstSafeStructuredIdentifier(
    [
      options.response?.headers.get("x-request-id"),
      options.response?.headers.get("request-id"),
      errorRecord?.requestId,
      errorRecord?.request_id,
      errorDetails?.requestId,
      errorDetails?.request_id,
      errorDetail?.requestId,
      errorDetail?.request_id,
      rootDetail?.requestId,
      rootDetail?.request_id,
      root?.requestId,
      root?.request_id,
    ],
    SAFE_REQUEST_ID_PATTERN,
    knownSecrets,
  );
  const retryAfterMs =
    retryAfterHeaderMs(options.response) ??
    payloadRetryAfterMs(root, errorRecord);
  const rawGuidance = firstString(
    errorRecord?.userFriendlyError,
    errorRecord?.guidance,
    errorRecord?.hint,
    errorRecord?.suggestion,
    errorDetails?.message,
    errorDetails?.userFriendlyError,
    errorDetails?.guidance,
    errorDetails?.hint,
    errorDetail?.message,
    errorDetail?.guidance,
    errorDetail?.hint,
    rootDetail?.message,
    rootDetail?.guidance,
    rootDetail?.hint,
    root?.userFriendlyError,
    root?.guidance,
    root?.hint,
    root?.suggestion,
    root?.refundMessage,
    root?.error_description,
  );
  const guidance = rawGuidance
    ? redactSecrets(rawGuidance, knownSecrets).trim().slice(0, 1_000)
    : "";
  const error = providerErrorMessage(payload, fallback, knownSecrets).slice(
    0,
    1_000,
  );

  return {
    error,
    ...(code ? { code } : {}),
    ...(parameter ? { parameter } : {}),
    ...(requestId ? { requestId } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(guidance && guidance !== error ? { guidance } : {}),
  };
};

export const safeErrorResponse = (
  error: unknown,
  status: number,
  fallback: string,
  knownSecrets: string[] = []
) =>
  Response.json(
    { error: providerErrorMessage(error, fallback, knownSecrets) },
    { status }
  );

export const jsonOrNull = async (
  response: Response,
  maxBytes?: number,
) => {
  try {
    return await readJsonResponse(response, maxBytes);
  } catch {
    return null;
  }
};
