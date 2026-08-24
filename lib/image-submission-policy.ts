import type { Provider } from "./constants.ts";

const NON_REPEATABLE_IMAGE_PROVIDERS = new Set<Provider>([
  "navy",
  "multillm",
]);

export const usesSingleImageSubmissionAttempt = (provider: Provider) =>
  NON_REPEATABLE_IMAGE_PROVIDERS.has(provider);

export const resolveImageSubmissionAttempts = ({
  provider,
  remoteJobId,
  configuredAttempts,
}: {
  provider: Provider;
  remoteJobId?: string;
  configuredAttempts: number;
}) =>
  remoteJobId || usesSingleImageSubmissionAttempt(provider)
    ? 1
    : configuredAttempts;
