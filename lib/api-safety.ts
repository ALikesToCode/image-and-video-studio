const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /Key\s+[A-Za-z0-9._~+/=-]+/gi,
  /x-goog-api-key["':\s]+[A-Za-z0-9._~+/=-]+/gi,
  /api[_-]?key["':\s]+[A-Za-z0-9._~+/=-]+/gi,
];

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

type ImageProvider = "gemini" | "navy" | "chutes" | "openrouter";

const PROVIDER_ENV_KEYS: Record<ImageProvider, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  navy: ["NAVY_API_KEY", "NAVYAI_API_KEY"],
  chutes: ["CHUTES_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
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

  for (const pattern of SECRET_PATTERNS) {
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
