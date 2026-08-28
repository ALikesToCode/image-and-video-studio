import type {
  ModelInputImageConstraints,
  ModelMediaConstraint,
  ModelOption,
  ModelParameterDescriptor,
  ModelParameterOption,
  ModelParameterType,
  ModelParameterValue,
} from "./constants";
import {
  isImageOutputModelOption,
  sortModelOptionsByProviderAndName,
} from "./model-options";

type UnknownRecord = Record<string, unknown>;
type MediaKind = "image" | "video";

const PARAMETER_TYPES = new Set<ModelParameterType>([
  "select",
  "switch",
  "boolean",
  "number",
  "text",
  "string",
]);

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PARAMETER_COUNT = 64;
const MAX_PARAMETER_OPTIONS = 100;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const firstPresent = (...values: unknown[]) =>
  values.find((value) => value !== undefined);

const toString = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const values = Array.from(
    new Set(value.map(toString).filter((entry): entry is string => !!entry)),
  );
  return values.length ? values : undefined;
};

const toFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toNonNegativeInteger = (value: unknown) => {
  const number = toFiniteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0
    ? number
    : undefined;
};

const minimumDefined = (...values: Array<number | undefined>) => {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length ? Math.min(...defined) : undefined;
};

const toParameterValue = (value: unknown): ModelParameterValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  return toFiniteNumber(value);
};

const sanitizeJsonValue = (
  value: unknown,
  ancestors = new WeakSet<object>(),
): unknown => {
  const scalar = toParameterValue(value);
  if (scalar !== undefined) return scalar;

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return undefined;
    ancestors.add(value);
    const sanitized = value
      .map((entry) => sanitizeJsonValue(entry, ancestors))
      .filter((entry) => entry !== undefined);
    ancestors.delete(value);
    return sanitized;
  }

  const record = asRecord(value);
  if (!record || ancestors.has(record)) return undefined;
  ancestors.add(record);
  const sanitized: UnknownRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const safeEntry = sanitizeJsonValue(entry, ancestors);
    if (safeEntry !== undefined) sanitized[key] = safeEntry;
  }
  ancestors.delete(record);
  return sanitized;
};

const toMediaConstraint = (value: unknown): ModelMediaConstraint | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;

  const constraint: ModelMediaConstraint = {};
  const numericFields = [
    ["minWidth", firstPresent(record.min_width, record.minWidth)],
    ["minHeight", firstPresent(record.min_height, record.minHeight)],
    ["maxWidth", firstPresent(record.max_width, record.maxWidth)],
    ["maxHeight", firstPresent(record.max_height, record.maxHeight)],
    ["maxBytes", firstPresent(record.max_bytes, record.maxBytes)],
  ] as const;
  for (const [key, rawValue] of numericFields) {
    const number = toNonNegativeInteger(rawValue);
    if (number !== undefined) constraint[key] = number;
  }

  const formats = toStringArray(record.formats);
  const source = toString(record.source);
  const note = toString(record.note);
  if (formats) constraint.formats = formats;
  if (source) constraint.source = source;
  if (note) constraint.note = note;

  return Object.keys(constraint).length ? constraint : undefined;
};

const toInputImageConstraints = (
  value: unknown,
): ModelInputImageConstraints | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;

  const constraints: ModelInputImageConstraints = {};
  const maxItems = toNonNegativeInteger(
    firstPresent(record.max_items, record.maxItems),
  );
  const route = toMediaConstraint(record.route);
  const provider = toMediaConstraint(record.provider);
  if (maxItems !== undefined) constraints.maxItems = maxItems;
  if (route) constraints.route = route;
  if (provider) constraints.provider = provider;

  return Object.keys(constraints).length ? constraints : undefined;
};

const toParameterOption = (value: unknown): ModelParameterOption | null => {
  const scalar = toParameterValue(value);
  if (scalar !== undefined && scalar !== null) {
    return { value: scalar, label: String(scalar) };
  }
  const record = asRecord(value);
  if (!record) return null;
  const optionValue = toParameterValue(record.value);
  if (optionValue === undefined || optionValue === null) return null;
  const label = toString(record.label) ?? String(optionValue);
  return { value: optionValue, label };
};

const toParameterOptions = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: ModelParameterOption[] = [];
  for (const entry of value.slice(0, MAX_PARAMETER_OPTIONS)) {
    const option = toParameterOption(entry);
    if (!option) continue;
    const identity = `${typeof option.value}:${String(option.value)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    options.push(option);
  }
  return options;
};

const validatedParameterValue = (
  descriptor: ModelParameterDescriptor,
  value: unknown,
): ModelParameterValue | undefined => {
  const candidate = toParameterValue(value);
  if (candidate === undefined || candidate === null) return undefined;

  if (descriptor.type === "select") {
    return descriptor.options?.some((option) =>
      Object.is(option.value, candidate),
    )
      ? candidate
      : undefined;
  }
  if (descriptor.type === "switch" || descriptor.type === "boolean") {
    return typeof candidate === "boolean" ? candidate : undefined;
  }
  if (descriptor.type === "number") {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      return undefined;
    }
    if (descriptor.min !== undefined && candidate < descriptor.min) {
      return undefined;
    }
    if (descriptor.max !== undefined && candidate > descriptor.max) {
      return undefined;
    }
    return candidate;
  }
  return typeof candidate === "string" ? candidate : undefined;
};

const toParameterDescriptor = (
  value: unknown,
): ModelParameterDescriptor | null => {
  const record = asRecord(value);
  const rawType = toString(record?.type)?.toLowerCase();
  if (!record || !rawType || !PARAMETER_TYPES.has(rawType as ModelParameterType)) {
    return null;
  }

  const descriptor: ModelParameterDescriptor = {
    type: rawType as ModelParameterType,
  };
  const label = toString(record.label);
  const description = toString(record.description);
  const placeholder = toString(record.placeholder);
  const min = toFiniteNumber(record.min);
  const max = toFiniteNumber(record.max);
  const step = toFiniteNumber(record.step);
  const options = toParameterOptions(record.options);
  const rawShowWhen = asRecord(record.showWhen);
  const showWhen: Record<string, ModelParameterValue> = {};
  if (rawShowWhen) {
    for (const [key, condition] of Object.entries(rawShowWhen)) {
      if (UNSAFE_KEYS.has(key) || !key.trim()) continue;
      const conditionValue = toParameterValue(condition);
      if (conditionValue !== undefined) showWhen[key] = conditionValue;
    }
  }

  if (label) descriptor.label = label;
  if (description) descriptor.description = description;
  if (placeholder) descriptor.placeholder = placeholder;
  if (options.length) descriptor.options = options;
  if (min !== undefined && (max === undefined || min <= max)) {
    descriptor.min = min;
  }
  if (max !== undefined && (min === undefined || min <= max)) {
    descriptor.max = max;
  }
  if (step !== undefined && step > 0) descriptor.step = step;
  if (Object.keys(showWhen).length) descriptor.showWhen = showWhen;
  if (descriptor.type === "select" && !descriptor.options?.length) return null;
  const defaultValue = validatedParameterValue(descriptor, record.default);
  if (defaultValue !== undefined) descriptor.default = defaultValue;
  return descriptor;
};

const toDynamicParameters = (...values: unknown[]) => {
  const parameters: Record<string, ModelParameterDescriptor> = {};
  for (const value of values) {
    const record = asRecord(value);
    if (!record) continue;
    for (const [key, rawDescriptor] of Object.entries(record).slice(
      0,
      MAX_PARAMETER_COUNT,
    )) {
      if (UNSAFE_KEYS.has(key) || !key.trim()) continue;
      const descriptor = toParameterDescriptor(rawDescriptor);
      if (descriptor) parameters[key] = descriptor;
    }
  }
  return parameters;
};

type DocumentedParameter = {
  type: "enum" | "range" | "boolean";
  descriptor?: ModelParameterDescriptor;
  min?: number;
  max?: number;
};

const toDocumentedParameter = (value: unknown): DocumentedParameter | null => {
  const record = asRecord(value);
  const type = toString(record?.type)?.toLowerCase();
  if (!record || !type) return null;

  // Capability-descriptor booleans mark a request field as supported; they do
  // not describe a boolean-valued UI control.
  if (type === "boolean") return { type };

  if (type === "enum") {
    const rawValues = Array.isArray(record.values)
      ? record.values.slice(0, MAX_PARAMETER_OPTIONS)
      : record.values;
    const values = toStringArray(rawValues);
    if (!values?.length) return null;
    const descriptor: ModelParameterDescriptor = {
      type: "select",
      options: values.map((entry) => ({ value: entry, label: entry })),
    };
    const defaultValue = validatedParameterValue(descriptor, record.default);
    if (defaultValue !== undefined) descriptor.default = defaultValue;
    return { type, descriptor };
  }

  if (type === "range") {
    const min = toFiniteNumber(record.min);
    const max = toFiniteNumber(record.max);
    if (
      min === undefined ||
      max === undefined ||
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min > max
    ) {
      return null;
    }
    const descriptor: ModelParameterDescriptor = {
      type: "number",
      min,
      max,
      step: 1,
    };
    const defaultValue = validatedParameterValue(descriptor, record.default);
    if (
      defaultValue !== undefined &&
      typeof defaultValue === "number" &&
      Number.isInteger(defaultValue)
    ) {
      descriptor.default = defaultValue;
    }
    return { type, descriptor, min, max };
  }

  return null;
};

const toDocumentedParameters = (value: unknown) => {
  const record = asRecord(value);
  const parameters: Record<string, DocumentedParameter> = {};
  if (!record) return parameters;

  for (const [key, rawDescriptor] of Object.entries(record).slice(
    0,
    MAX_PARAMETER_COUNT,
  )) {
    if (UNSAFE_KEYS.has(key) || !key.trim()) continue;
    const parameter = toDocumentedParameter(rawDescriptor);
    if (parameter) parameters[key] = parameter;
  }
  return parameters;
};

const toDocumentedDynamicParameters = (
  parameters: Record<string, DocumentedParameter>,
) => {
  const dynamicParameters: Record<string, ModelParameterDescriptor> = {};
  for (const [key, parameter] of Object.entries(parameters)) {
    if (key === "n" || key === "input_references" || !parameter.descriptor) {
      continue;
    }
    dynamicParameters[key] = parameter.descriptor;
  }
  return dynamicParameters;
};

const toParameterDefaults = (
  rawDefaults: unknown[],
  parameters: Record<string, ModelParameterDescriptor>,
) => {
  const defaults: Record<string, ModelParameterValue> = {};
  for (const [key, parameter] of Object.entries(parameters)) {
    if (parameter.default !== undefined) defaults[key] = parameter.default;
  }

  for (const rawDefaultSet of rawDefaults) {
    const record = asRecord(rawDefaultSet);
    if (!record) continue;
    for (const [key, rawValue] of Object.entries(record)) {
      if (!(key in parameters)) continue;
      const value = validatedParameterValue(parameters[key], rawValue);
      if (value !== undefined) defaults[key] = value;
    }
  }
  return defaults;
};

const extractCatalogRecords = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  const envelope = asRecord(payload);
  if (!envelope) return [];
  if (Array.isArray(envelope.data)) return envelope.data;
  if (Array.isArray(envelope.models)) return envelope.models;
  return [];
};

const normalizeCatalogModel = (
  value: unknown,
  kind: MediaKind,
): ModelOption | null => {
  const record = asRecord(value);
  const id = toString(record?.id);
  if (!record || !id) return null;

  const architecture = asRecord(record.architecture);
  const capabilities = asRecord(record.capabilities) ?? {};
  const supportedParameters =
    asRecord(
      firstPresent(record.supported_parameters, record.supportedParameters),
    ) ?? {};
  const documentedParameters = toDocumentedParameters(supportedParameters);
  const inputModalities = toStringArray(
    firstPresent(
      record.input_modalities,
      record.inputModalities,
      architecture?.input_modalities,
      architecture?.inputModalities,
    ),
  );
  const outputModalities = toStringArray(
    firstPresent(
      record.output_modalities,
      record.outputModalities,
      architecture?.output_modalities,
      architecture?.outputModalities,
    ),
  );
  const modality = toString(firstPresent(record.modality, architecture?.modality));
  const description = toString(record.description);
  const pricing = sanitizeJsonValue(record.pricing);
  const supportedResolutions = toStringArray(
    firstPresent(
      supportedParameters.resolutions,
      supportedParameters.supported_resolutions,
      supportedParameters.supportedResolutions,
    ),
  );
  const inputImageConstraints = toInputImageConstraints(
    firstPresent(
      supportedParameters.input_image_constraints,
      supportedParameters.inputImageConstraints,
    ),
  );
  const maxReferenceImages = minimumDefined(
    toNonNegativeInteger(
      firstPresent(
        supportedParameters.max_input_images,
        supportedParameters.maxInputImages,
      ),
    ),
    inputImageConstraints?.maxItems,
    documentedParameters.input_references?.type === "range" &&
      documentedParameters.input_references.min !== undefined &&
      documentedParameters.input_references.min >= 0
      ? toNonNegativeInteger(documentedParameters.input_references.max)
      : undefined,
  );
  const dynamicParameters = {
    ...toDynamicParameters(
      supportedParameters.parameters,
      supportedParameters.dynamic_parameters,
      supportedParameters.dynamicParameters,
    ),
    ...toDocumentedDynamicParameters(documentedParameters),
  };
  const parameterDefaults = toParameterDefaults(
    [
      supportedParameters.defaults,
      supportedParameters.parameter_defaults,
      supportedParameters.parameterDefaults,
    ],
    dynamicParameters,
  );
  const parameterNames = Array.from(
    new Set([
      ...Object.keys(dynamicParameters),
      ...Object.keys(documentedParameters),
    ]),
  );
  const documentedResolutionOptions = documentedParameters.resolution?.descriptor
    ?.options?.map((option) =>
      typeof option.value === "string" ? option.value : undefined,
    )
    .filter((entry): entry is string => !!entry);
  const resolutionOptions = dynamicParameters.resolution?.options
    ?.map((option) =>
      typeof option.value === "string" || typeof option.value === "number"
        ? String(option.value)
        : undefined,
    )
    .filter((entry): entry is string => !!entry);
  const normalizedResolutions =
    (documentedResolutionOptions?.length
      ? documentedResolutionOptions
      : undefined) ??
    supportedResolutions ??
    (resolutionOptions?.length
      ? Array.from(new Set(resolutionOptions))
      : undefined);
  const hasImageInput =
    inputModalities?.some((entry) => entry.toLowerCase() === "image") ?? false;
  const hasReferenceParameter = parameterNames.some((name) =>
    /reference.*image|image.*reference/i.test(name),
  );
  const hasDocumentedInputReferences =
    documentedParameters.input_references?.type === "range" &&
    maxReferenceImages !== undefined &&
    maxReferenceImages > 0;
  const supports: NonNullable<ModelOption["supports"]> = {};

  if (kind === "image") {
    if (
      capabilities.image_generation === true ||
      outputModalities?.some((entry) => entry.toLowerCase() === "image")
    ) {
      supports.imageGeneration = true;
    }
    if (
      capabilities.image_to_image === true ||
      capabilities.inpainting === true ||
      hasImageInput ||
      hasDocumentedInputReferences
    ) {
      supports.imageEdit = true;
      supports.referenceImages = true;
      supports.sourceImage = true;
    } else if (maxReferenceImages !== undefined && maxReferenceImages > 0) {
      supports.referenceImages = true;
    }
  } else {
    if (
      capabilities.video_generation === true ||
      outputModalities?.some((entry) => entry.toLowerCase() === "video")
    ) {
      supports.video = true;
    }
    supports.asyncJobs = true;
    if (typeof capabilities.text_to_video === "boolean") {
      supports.textToVideo = capabilities.text_to_video;
    }
    if (typeof capabilities.image_to_video === "boolean") {
      supports.imageToVideo = capabilities.image_to_video;
    }
    if (supports.imageToVideo === true || hasImageInput) {
      supports.sourceImage = true;
    }
    if (
      hasReferenceParameter ||
      (maxReferenceImages !== undefined && maxReferenceImages > 0)
    ) {
      supports.referenceImages = true;
    }
  }

  if (normalizedResolutions?.length || "resolution" in dynamicParameters) {
    supports.size = true;
  }
  if (parameterNames.some((name) => /^seed$/i.test(name))) supports.seed = true;
  if (parameterNames.some((name) => /aspect_?ratio/i.test(name))) {
    supports.aspectRatio = true;
  }
  if (parameterNames.some((name) => /negative_?prompt/i.test(name))) {
    supports.negativePrompt = true;
  }
  if (parameterNames.some((name) => /first_?frame/i.test(name))) {
    supports.firstFrame = true;
  }
  if (parameterNames.some((name) => /last_?frame|end_?frame/i.test(name))) {
    supports.lastFrame = true;
  }

  const model: ModelOption = {
    id,
    label: toString(firstPresent(record.name, record.label)) ?? id,
    provider: "nanogpt",
    endpoint:
      kind === "image"
        ? "nanogpt-images-generations"
        : "nanogpt-video-generation",
    metadataSource: "nanogpt-catalog",
    metadataStatus: "known",
    supports,
  };
  if (inputModalities) model.inputModalities = inputModalities;
  if (outputModalities) model.outputModalities = outputModalities;
  if (modality) model.modality = modality;
  if (description) model.description = description;
  if (pricing !== undefined) model.pricing = pricing;
  if (normalizedResolutions) model.supportedResolutions = normalizedResolutions;
  if (maxReferenceImages !== undefined) {
    model.maxReferenceImages = maxReferenceImages;
  }
  if (inputImageConstraints) model.inputImageConstraints = inputImageConstraints;
  if (Object.keys(dynamicParameters).length) {
    model.dynamicParameters = dynamicParameters;
  }
  if (Object.keys(parameterDefaults).length) {
    model.parameterDefaults = parameterDefaults;
  }

  if (kind === "image") {
    const documentedImageCount = documentedParameters.n;
    const documentedMaxOutputImages =
      documentedImageCount?.type === "range" &&
      documentedImageCount.min !== undefined &&
      documentedImageCount.min >= 1
        ? toNonNegativeInteger(documentedImageCount.max)
        : undefined;
    const maxOutputImages = minimumDefined(
      toNonNegativeInteger(
        firstPresent(
          supportedParameters.max_images,
          supportedParameters.maxImages,
        ),
      ),
      toNonNegativeInteger(
        firstPresent(
          supportedParameters.max_output_images,
          supportedParameters.maxOutputImages,
        ),
      ),
      documentedMaxOutputImages,
    );
    const catalogFixedOutputImages = toNonNegativeInteger(
      firstPresent(
        supportedParameters.fixed_image_count,
        supportedParameters.fixedImageCount,
      ),
    );
    const documentedFixedOutputImages =
      documentedMaxOutputImages !== undefined &&
      documentedImageCount?.min === documentedImageCount.max
        ? documentedMaxOutputImages
        : undefined;
    const fixedOutputImages =
      catalogFixedOutputImages ?? documentedFixedOutputImages;
    if (maxOutputImages !== undefined) model.maxOutputImages = maxOutputImages;
    if (fixedOutputImages !== undefined) {
      model.fixedOutputImages = fixedOutputImages;
    }
  }

  return model;
};

const normalizeCatalog = (payload: unknown, kind: MediaKind): ModelOption[] => {
  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const entry of extractCatalogRecords(payload)) {
    const model = normalizeCatalogModel(entry, kind);
    if (
      !model ||
      (kind === "image" && !isImageOutputModelOption(model)) ||
      seen.has(model.id)
    ) {
      continue;
    }
    seen.add(model.id);
    models.push(model);
  }
  return kind === "image"
    ? sortModelOptionsByProviderAndName(models)
    : models;
};

export const normalizeNanoGptImageModels = (payload: unknown): ModelOption[] =>
  normalizeCatalog(payload, "image");

export const normalizeNanoGptVideoModels = (payload: unknown): ModelOption[] =>
  normalizeCatalog(payload, "video");
