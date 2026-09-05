export const DEFAULT_IMAGE_RETRY_ATTEMPTS = 2;
export const MAX_IMAGE_RETRY_ATTEMPTS = 8;

export const normalizeImageRetryAttempts = (
  value: unknown,
  fallback = DEFAULT_IMAGE_RETRY_ATTEMPTS,
) => {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return fallback;
  }
  return Math.min(MAX_IMAGE_RETRY_ATTEMPTS, Math.floor(numericValue));
};

type AttemptState = { attempt: number; maxAttempts: number };
type FailedAttemptState = AttemptState & { error: unknown };

export const retryAsyncOperation = async <T>({
  maxAttempts,
  run,
  onAttempt,
  onError,
  shouldRetry,
  beforeRetry,
}: {
  maxAttempts: unknown;
  run: (state: AttemptState) => Promise<T>;
  onAttempt?: (state: AttemptState) => void;
  onError?: (state: FailedAttemptState & { final: boolean }) => void;
  shouldRetry?: (error: unknown) => boolean;
  beforeRetry?: (state: FailedAttemptState) => Promise<void>;
}) => {
  const attempts = normalizeImageRetryAttempts(maxAttempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    onAttempt?.({ attempt, maxAttempts: attempts });
    try {
      return await run({ attempt, maxAttempts: attempts });
    } catch (error) {
      lastError = error;
      const final = attempt >= attempts || shouldRetry?.(error) === false;
      onError?.({ attempt, maxAttempts: attempts, error, final });
      if (final) throw error;
      await beforeRetry?.({ attempt, maxAttempts: attempts, error });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Operation failed.");
};
