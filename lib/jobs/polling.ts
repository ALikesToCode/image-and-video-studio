export type PollOperationOptions<TPollResult, TResult> = {
  poll: (attempt: number, signal: AbortSignal) => Promise<TPollResult>;
  isDone: (result: TPollResult) => boolean;
  getResult: (result: TPollResult) => TResult;
  intervalMs: number;
  maxAttempts: number;
  backoff?: {
    factor?: number;
    maxIntervalMs?: number;
    jitterRatio?: number;
  };
  signal?: AbortSignal;
  onProgress?: (state: { attempt: number; nextDelayMs: number }) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Polling was cancelled.", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Polling was cancelled.", "AbortError"));
      },
      { once: true }
    );
  });

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new DOMException("Polling was cancelled.", "AbortError");
  }
};

export const computeBackoffDelay = ({
  attempt,
  intervalMs,
  factor = 1,
  maxIntervalMs = Number.POSITIVE_INFINITY,
  jitterRatio = 0,
  random = Math.random,
}: {
  attempt: number;
  intervalMs: number;
  factor?: number;
  maxIntervalMs?: number;
  jitterRatio?: number;
  random?: () => number;
}) => {
  const base = Math.min(maxIntervalMs, intervalMs * Math.max(1, factor) ** attempt);
  if (!jitterRatio) return Math.round(base);
  const jitter = base * jitterRatio * random();
  return Math.round(Math.min(maxIntervalMs, base + jitter));
};

export async function pollOperation<TPollResult, TResult>({
  poll,
  isDone,
  getResult,
  intervalMs,
  maxAttempts,
  backoff,
  signal,
  onProgress,
  sleep = defaultSleep,
  random = Math.random,
}: PollOperationOptions<TPollResult, TResult>): Promise<TResult> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(controller.signal);
      const result = await poll(attempt, controller.signal);
      if (isDone(result)) return getResult(result);

      if (attempt === maxAttempts - 1) break;
      const nextDelayMs = computeBackoffDelay({
        attempt,
        intervalMs,
        random,
        ...backoff,
      });
      onProgress?.({ attempt: attempt + 1, nextDelayMs });
      await sleep(nextDelayMs, controller.signal);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  throw new Error("Polling timed out.");
}
