import type {
  ModelOption,
  ModelParameterDescriptor,
  ModelParameterType,
  ModelParameterValue,
} from "./constants.ts";

export type ModelParameterValues = Record<string, ModelParameterValue>;

const PARAMETER_TYPES = new Set<ModelParameterType>([
  "select",
  "switch",
  "boolean",
  "number",
  "text",
  "string",
]);

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const scalarParameterValue = (value: unknown): ModelParameterValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const optionalText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const sanitizeModelParameterDescriptors = (
  value: unknown,
): NonNullable<ModelOption["dynamicParameters"]> => {
  if (!isRecord(value)) return {};
  const descriptors: NonNullable<ModelOption["dynamicParameters"]> = {};
  for (const [key, rawDescriptor] of Object.entries(value).slice(0, 64)) {
    if (UNSAFE_KEYS.has(key) || !key.trim() || !isRecord(rawDescriptor)) continue;
    const rawType = optionalText(rawDescriptor.type)?.toLowerCase();
    if (!rawType || !PARAMETER_TYPES.has(rawType as ModelParameterType)) {
      continue;
    }
    const descriptor: ModelParameterDescriptor = {
      type: rawType as ModelParameterDescriptor["type"],
    };
    for (const field of ["label", "description", "placeholder"] as const) {
      const text = optionalText(rawDescriptor[field]);
      if (text) descriptor[field] = text;
    }
    for (const field of ["min", "max", "step"] as const) {
      const number = rawDescriptor[field];
      if (typeof number === "number" && Number.isFinite(number)) {
        descriptor[field] = number;
      }
    }
    if (Array.isArray(rawDescriptor.options)) {
      const options = rawDescriptor.options
        .slice(0, 100)
        .map((rawOption) => {
          if (!isRecord(rawOption)) return null;
          const optionValue = scalarParameterValue(rawOption.value);
          if (optionValue === undefined || optionValue === null) return null;
          return {
            value: optionValue,
            label: optionalText(rawOption.label) ?? String(optionValue),
          };
        })
        .filter((option): option is NonNullable<typeof option> => !!option);
      if (options.length) descriptor.options = options;
    }
    if (descriptor.type === "select" && !descriptor.options?.length) continue;
    if (
      typeof descriptor.min === "number" &&
      typeof descriptor.max === "number" &&
      descriptor.min > descriptor.max
    ) {
      delete descriptor.min;
      delete descriptor.max;
    }
    if (typeof descriptor.step === "number" && descriptor.step <= 0) {
      delete descriptor.step;
    }
    if (isRecord(rawDescriptor.showWhen)) {
      const showWhen: NonNullable<ModelParameterDescriptor["showWhen"]> = {};
      for (const [conditionKey, rawCondition] of Object.entries(rawDescriptor.showWhen)) {
        if (UNSAFE_KEYS.has(conditionKey) || !conditionKey.trim()) continue;
        const condition = scalarParameterValue(rawCondition);
        if (condition !== undefined) showWhen[conditionKey] = condition;
      }
      if (Object.keys(showWhen).length) descriptor.showWhen = showWhen;
    }
    const defaultValue = coerceModelParameterValue(
      descriptor,
      scalarParameterValue(rawDescriptor.default),
    );
    if (defaultValue !== undefined) descriptor.default = defaultValue;
    descriptors[key] = descriptor;
  }
  return descriptors;
};

export const sanitizeModelParameterDefaults = (
  value: unknown,
  descriptors: NonNullable<ModelOption["dynamicParameters"]>,
): NonNullable<ModelOption["parameterDefaults"]> => {
  if (!isRecord(value)) return {};
  const defaults: NonNullable<ModelOption["parameterDefaults"]> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    const defaultValue = coerceModelParameterValue(descriptor, value[key]);
    if (defaultValue !== undefined) defaults[key] = defaultValue;
  }
  return defaults;
};

export const modelParameterPreferenceKey = (
  provider: string,
  mode: string,
  modelId: string,
) => `${provider}:${mode}:${modelId}`;

export const readModelParameterPreference = (
  preferences: Record<string, ModelParameterValues>,
  provider: string,
  mode: string,
  modelId: string,
): ModelParameterValues => {
  const scopedKey = modelParameterPreferenceKey(provider, mode, modelId);
  if (Object.prototype.hasOwnProperty.call(preferences, scopedKey)) {
    return preferences[scopedKey] ?? {};
  }
  if (Object.prototype.hasOwnProperty.call(preferences, modelId)) {
    return preferences[modelId] ?? {};
  }
  return {};
};

const clamp = (value: number, descriptor: ModelParameterDescriptor) => {
  const minimum = descriptor.min;
  const maximum = descriptor.max;
  return Math.min(
    typeof maximum === "number" ? maximum : value,
    Math.max(typeof minimum === "number" ? minimum : value, value),
  );
};

export const coerceModelParameterValue = (
  descriptor: ModelParameterDescriptor,
  value: unknown,
): ModelParameterValue | undefined => {
  if (value === null || value === undefined) return undefined;

  if (descriptor.type === "select") {
    const option = descriptor.options?.find(
      (entry) => Object.is(entry.value, value) || String(entry.value) === String(value),
    );
    return option?.value;
  }

  if (descriptor.type === "switch" || descriptor.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }

  if (descriptor.type === "number") {
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(number)) return undefined;
    return clamp(number, descriptor);
  }

  if (descriptor.type === "text" || descriptor.type === "string") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  return undefined;
};

export const isModelParameterVisible = (
  descriptor: ModelParameterDescriptor,
  values: ModelParameterValues,
) => {
  if (!descriptor.showWhen) return true;
  return Object.entries(descriptor.showWhen).every(([key, expected]) =>
    Object.is(values[key], expected),
  );
};

export const resolveModelParameterValues = (
  model: ModelOption | undefined,
  current: ModelParameterValues = {},
): ModelParameterValues => {
  const parameters = model?.dynamicParameters ?? {};
  const defaults = model?.parameterDefaults ?? {};
  const resolved: ModelParameterValues = {};

  for (const [key, descriptor] of Object.entries(parameters)) {
    const currentValue = coerceModelParameterValue(descriptor, current[key]);
    if (currentValue !== undefined) {
      resolved[key] = currentValue;
      continue;
    }
    const defaultValue = coerceModelParameterValue(
      descriptor,
      defaults[key] ?? descriptor.default,
    );
    if (defaultValue !== undefined) {
      resolved[key] = defaultValue;
    }
  }

  return resolved;
};

export const buildModelParameterPayload = (
  model: ModelOption | undefined,
  values: ModelParameterValues,
) => {
  const parameters = model?.dynamicParameters ?? {};
  const payload: Record<string, Exclude<ModelParameterValue, null>> = {};

  for (const [key, descriptor] of Object.entries(parameters)) {
    if (!isModelParameterVisible(descriptor, values)) continue;
    const value = coerceModelParameterValue(descriptor, values[key]);
    if (value === undefined || value === null || value === "") continue;
    payload[key] = value;
  }

  return payload;
};
