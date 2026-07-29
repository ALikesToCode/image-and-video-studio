type UnknownRecord = Record<string, unknown>;

type ProviderErrorDisplayOptions = {
  fallback: string;
  status?: number;
};

const MAX_FIELD_LENGTH = 1_000;
const MAX_MESSAGE_LENGTH = 2_000;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const cleanText = (value: unknown, maxLength = MAX_FIELD_LENGTH) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength)
    : "";

const safeRetryDelay = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

export const formatProviderErrorForDisplay = (
  payload: unknown,
  options: ProviderErrorDisplayOptions,
) => {
  const root = asRecord(payload);
  const nestedError = asRecord(root?.error);
  const message =
    cleanText(root?.error) ||
    cleanText(nestedError?.message) ||
    cleanText(root?.message) ||
    options.fallback;
  const code = cleanText(root?.code) || cleanText(nestedError?.code);
  const parameter =
    cleanText(root?.parameter) ||
    cleanText(root?.param) ||
    cleanText(nestedError?.parameter) ||
    cleanText(nestedError?.param);
  const requestId =
    cleanText(root?.requestId) ||
    cleanText(root?.request_id) ||
    cleanText(nestedError?.requestId) ||
    cleanText(nestedError?.request_id);
  const guidance =
    cleanText(root?.guidance) ||
    cleanText(root?.hint) ||
    cleanText(nestedError?.guidance) ||
    cleanText(nestedError?.hint);
  const retryAfterMs =
    safeRetryDelay(root?.retryAfterMs) ??
    safeRetryDelay(root?.retry_after_ms) ??
    safeRetryDelay(nestedError?.retryAfterMs) ??
    safeRetryDelay(nestedError?.retry_after_ms);

  const context = [
    Number.isInteger(options.status) && Number(options.status) >= 400
      ? `HTTP ${options.status}`
      : "",
    code ? `code ${code}` : "",
    parameter ? `parameter ${parameter}` : "",
    requestId ? `request ${requestId}` : "",
  ].filter(Boolean);
  const detail =
    guidance && guidance.toLowerCase() !== message.toLowerCase()
      ? ` Detail: ${guidance}`
      : "";
  const retry =
    retryAfterMs !== undefined
      ? ` Retry after ${Math.max(1, Math.ceil(retryAfterMs / 1_000))}s.`
      : "";

  return `${message}${context.length ? ` [${context.join("; ")}]` : ""}${detail}${retry}`.slice(
    0,
    MAX_MESSAGE_LENGTH,
  );
};
