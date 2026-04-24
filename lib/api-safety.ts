const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /Key\s+[A-Za-z0-9._~+/=-]+/gi,
  /x-goog-api-key["':\s]+[A-Za-z0-9._~+/=-]+/gi,
  /api[_-]?key["':\s]+[A-Za-z0-9._~+/=-]+/gi,
];

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

export const getUserApiKey = (
  req: Request,
  body?: Record<string, unknown> | null
) => {
  const headerKey = req.headers.get("x-user-api-key")?.trim();
  if (headerKey) return headerKey;
  const bodyKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  return bodyKey;
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
