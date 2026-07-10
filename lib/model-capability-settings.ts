import type {
  ModelOption,
  ModelParameterDescriptor,
  ModelParameterValue,
} from "./constants.ts";

export type ModelParameterValues = Record<string, ModelParameterValue>;

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
