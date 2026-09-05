import { formatProviderErrorForDisplay } from "./provider-error.ts";

const TRANSIENT_STATUSES = new Set([
  408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);
const MAX_RETRY_DELAY_MS = 60_000;
const TERMINAL_ERROR =
  /insufficient[\s_-]*(?:balance|credits?|funds|quota)|(?:balance|credits?|quota)[\s_-]*(?:exhausted|depleted)|billing[\s_-]*hard[\s_-]*limit|invalid[\s_-]*(?:api[\s_-]*key|parameter|request)|unauthori[sz]ed|authentication|permission[\s_-]*denied|content[\s_-]*policy[\s_-]*violation|subscription[\s_-]*required/i;

const retryAfterMs = (response: Response, payload: Record<string, unknown>) => {
  const header = response.headers.get("retry-after")?.trim();
  if (header) {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds)
      ? seconds * 1_000
      : Date.parse(header) - Date.now();
    if (Number.isFinite(delay) && delay >= 0) return delay;
  }
  const nested = payload.error && typeof payload.error === "object"
    ? payload.error as Record<string, unknown>
    : {};
  return [payload.retryAfterMs, payload.retry_after_ms, nested.retryAfterMs, nested.retry_after_ms]
    .find((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0);
};

export class ImageSubmissionError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(response: Response, payload: Record<string, unknown>) {
    super(formatProviderErrorForDisplay(payload, {
      fallback: "Image generation failed.",
      status: response.status,
    }));
    this.name = "ImageSubmissionError";
    this.retryAfterMs = retryAfterMs(response, payload);
    this.retryable = TRANSIENT_STATUSES.has(response.status) &&
      payload.code !== "image_result_unavailable" &&
      !TERMINAL_ERROR.test(this.message) &&
      (this.retryAfterMs === undefined || this.retryAfterMs <= MAX_RETRY_DELAY_MS);
  }
}

export const isRetryableImageSubmissionError = (error: unknown) =>
  error instanceof ImageSubmissionError && error.retryable;

export const submitImageRequest = async (
  endpoint: string,
  init: RequestInit,
): Promise<Record<string, unknown>> => {
  init.signal?.throwIfAborted();
  const response = await fetch(endpoint, { ...init, method: "POST" });
  const value: unknown = await response.json().catch(() => null);
  init.signal?.throwIfAborted();
  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (!response.ok) throw new ImageSubmissionError(response, payload);
  return payload;
};

export const waitForImageSubmissionRetry = async (
  error: unknown,
  attempt: number,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  if (!(error instanceof ImageSubmissionError) || !error.retryable) return;
  const delayMs = Math.max(
    Math.min(1_000 * 2 ** (attempt - 1), 30_000),
    error.retryAfterMs ?? 0,
  );
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Image generation was cancelled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  signal?.throwIfAborted();
};
