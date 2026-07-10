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

type ImageProvider = "gemini" | "navy" | "chutes" | "openrouter" | "nanogpt";

const PROVIDER_ENV_KEYS: Record<ImageProvider, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  navy: ["NAVY_API_KEY", "NAVYAI_API_KEY", "NAVY_API"],
  chutes: ["CHUTES_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  nanogpt: ["NANOGPT_API_KEY", "NANO_GPT_API_KEY"],
};

const CORS_ALLOWED_SUFFIXES = ["janitorai.com"];
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

export const getProviderApiKey = (
  provider: ImageProvider,
  req: Request,
  body?: Record<string, unknown> | null
) => {
  for (const envKey of PROVIDER_ENV_KEYS[provider]) {
    const apiKey = process.env[envKey]?.trim();
    if (apiKey) return apiKey;
  }
  return getUserApiKey(req, body);
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

export const isAllowedJanitorAiCorsOrigin = (origin: string) => {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return CORS_ALLOWED_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
};

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
  if (origin && isAllowedJanitorAiCorsOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
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
  const raw =
    typeof errorRecord?.message === "string"
      ? errorRecord.message
      : typeof error === "string"
        ? error
        : typeof root?.message === "string"
          ? root.message
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
  const code = firstSafeStructuredIdentifier(
    [errorRecord?.code, root?.code, errorRecord?.type, root?.type],
    SAFE_CODE_PATTERN,
    knownSecrets,
  );
  const parameter = firstSafeStructuredIdentifier(
    [
      errorRecord?.param,
      errorRecord?.parameter,
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
    root?.userFriendlyError,
    root?.guidance,
    root?.hint,
    root?.suggestion,
    root?.refundMessage
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

export const jsonOrNull = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};
