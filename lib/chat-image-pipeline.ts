import {
  retryAsyncOperation,
  resolveActiveImageToolModels,
} from "./studio-generation.ts";

export const normalizeImageToolModelRequest = ({
  requestedModel,
}: {
  requestedModel: string;
}) => {
  return requestedModel.trim();
};

export const resolveRequestedImageModels = ({
  requestedModel,
  defaultModel,
  imagePipelineEnabled,
  imageModelOrder,
  availableModels,
}: {
  requestedModel: string;
  defaultModel: string;
  imagePipelineEnabled: boolean;
  imageModelOrder: string[];
  availableModels: string[];
}) => {
  const normalizedRequestedModel = requestedModel.trim();
  const normalizedDefaultModel = defaultModel.trim();
  const activeModels = resolveActiveImageToolModels({
    pipelineEnabled: imagePipelineEnabled,
    preferredModels: imageModelOrder,
    fallbackModel: normalizedDefaultModel,
    availableModels,
  });

  if (!normalizedRequestedModel) return activeModels;

  const requestedIsAvailable = availableModels.includes(normalizedRequestedModel);
  if (!requestedIsAvailable) {
    return imagePipelineEnabled ? activeModels : [];
  }

  if (!imagePipelineEnabled) return [normalizedRequestedModel];

  if (normalizedRequestedModel === normalizedDefaultModel) {
    return activeModels;
  }

  return [
    normalizedRequestedModel,
    ...activeModels.filter((model) => model !== normalizedRequestedModel),
  ];
};

type ImageModelFallbackError = {
  model: string;
  reason: unknown;
};

type ImageModelFallbackUpdate<T> =
  | { model: string; status: "running" }
  | { model: string; status: "success"; value: T }
  | { model: string; status: "error"; error: unknown };

type ImageModelPipelineError = {
  model: string;
  reason: unknown;
  attempts: number;
};

type ImageModelPipelineUpdate<T> =
  | {
      model: string;
      status: "running";
      attempt: number;
      maxAttempts: number;
    }
  | {
      model: string;
      status: "success";
      value: T;
      attempt: number;
      maxAttempts: number;
    }
  | {
      model: string;
      status: "error";
      error: unknown;
      attempt: number;
      maxAttempts: number;
    };

type ImageModelPipelineSettled<T> =
  | { model: string; status: "fulfilled"; value: T }
  | {
      model: string;
      status: "rejected";
      reason: unknown;
      attempts: number;
    };

type ImageModelPipelineRunState = {
  attempt: number;
  maxAttempts: number;
};

export const runImageModelFallbackSequence = async <T>({
  models,
  runModel,
  onUpdate,
}: {
  models: string[];
  runModel: (model: string) => Promise<T>;
  onUpdate?: (update: ImageModelFallbackUpdate<T>) => void;
}): Promise<
  | {
      status: "fulfilled";
      model: string;
      value: T;
      errors: ImageModelFallbackError[];
    }
  | { status: "rejected"; errors: ImageModelFallbackError[] }
> => {
  const errors: ImageModelFallbackError[] = [];

  for (const model of models) {
    onUpdate?.({ model, status: "running" });
    try {
      const value = await runModel(model);
      onUpdate?.({ model, status: "success", value });
      return { status: "fulfilled", model, value, errors };
    } catch (error) {
      errors.push({ model, reason: error });
      onUpdate?.({ model, status: "error", error });
    }
  }

  return { status: "rejected", errors };
};

export const runImageModelPipelineParallel = async <T>({
  models,
  maxAttempts,
  runModel,
  shouldRetry,
  onUpdate,
}: {
  models: string[];
  maxAttempts: unknown;
  runModel: (model: string, state: ImageModelPipelineRunState) => Promise<T>;
  shouldRetry?: (model: string, error: unknown) => boolean;
  onUpdate?: (update: ImageModelPipelineUpdate<T>) => void;
}): Promise<
  | {
      status: "fulfilled";
      values: Array<{ model: string; value: T }>;
      errors: ImageModelPipelineError[];
    }
  | { status: "rejected"; errors: ImageModelPipelineError[] }
> => {
  const settled: Array<ImageModelPipelineSettled<T>> = await Promise.all(
    models.map(async (model): Promise<ImageModelPipelineSettled<T>> => {
      let lastAttempt = 0;
      let configuredAttempts = 1;
      try {
        const value = await retryAsyncOperation({
          maxAttempts,
          onAttempt: ({ attempt, maxAttempts: attempts }) => {
            lastAttempt = attempt;
            configuredAttempts = attempts;
            onUpdate?.({
              model,
              status: "running",
              attempt,
              maxAttempts: attempts,
            });
          },
          run: async (state) => await runModel(model, state),
          shouldRetry: (error) => shouldRetry?.(model, error) ?? true,
          onError: ({ attempt, maxAttempts: attempts, error, final }) => {
            lastAttempt = attempt;
            if (!final) return;
            onUpdate?.({
              model,
              status: "error",
              error,
              attempt,
              maxAttempts: attempts,
            });
          },
        });
        onUpdate?.({
          model,
          status: "success",
          value,
          attempt: lastAttempt,
          maxAttempts: configuredAttempts,
        });
        return { model, status: "fulfilled" as const, value };
      } catch (error) {
        return {
          model,
          status: "rejected" as const,
          reason: error,
          attempts: lastAttempt,
        };
      }
    })
  );

  const values = settled
    .filter((entry): entry is Extract<ImageModelPipelineSettled<T>, { status: "fulfilled" }> =>
      entry.status === "fulfilled"
    )
    .map((entry) => ({ model: entry.model, value: entry.value }));
  const errors = settled
    .filter((entry): entry is Extract<ImageModelPipelineSettled<T>, { status: "rejected" }> =>
      entry.status === "rejected"
    )
    .map(({ model, reason, attempts }) => ({ model, reason, attempts }));

  if (values.length) {
    return { status: "fulfilled", values, errors };
  }

  return { status: "rejected", errors };
};
