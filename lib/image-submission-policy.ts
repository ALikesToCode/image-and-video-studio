import type { Provider } from "./constants.ts";

const NON_REPEATABLE_IMAGE_PROVIDERS = new Set<Provider>([
  "navy",
]);

export const usesSingleImageSubmissionAttempt = (provider: Provider, model?: string) =>
  NON_REPEATABLE_IMAGE_PROVIDERS.has(provider) ||
  (provider === "multillm" && model?.startsWith("navyai:") === true);

export const resolveImageSubmissionAttempts = ({
  provider,
  model,
  remoteJobId,
  configuredAttempts,
}: {
  provider: Provider;
  model?: string;
  remoteJobId?: string;
  configuredAttempts: number;
}) =>
  remoteJobId || usesSingleImageSubmissionAttempt(provider, model)
    ? 1
    : configuredAttempts;
