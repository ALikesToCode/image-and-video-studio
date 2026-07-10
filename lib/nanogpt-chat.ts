import type { ModelOption } from "./constants.ts";

type UnknownRecord = Record<string, unknown>;

export type NanoGptChatCapabilities = {
  vision?: boolean;
  video_input?: boolean;
  audio_input?: boolean;
  reasoning?: boolean;
  tool_calling?: boolean;
  parallel_tool_calls?: boolean;
  structured_output?: boolean;
  pdf_upload?: boolean;
};

export type NanoGptChatPricing = {
  prompt?: number;
  completion?: number;
  cacheReadInputPer1kTokens?: number;
  cacheWriteInputPer1kTokens?: number;
  currency?: string;
  unit?: string;
  note?: string;
};

export type NanoGptSubscription = {
  included?: boolean;
  inputTokenMultiplier?: number;
  note?: string;
};

export type NanoGptDistillationPolicy = {
  status?: string;
  label?: string;
  basis?: string;
  sourceUrl?: string;
  note?: string;
};

export type NanoGptChatModel = ModelOption & {
  object?: "model";
  created?: number;
  ownedBy?: string;
  capabilities?: NanoGptChatCapabilities;
  pricing?: NanoGptChatPricing;
  iconUrl?: string;
  costEstimate?: unknown;
  category?: string;
  supportsVideoInput?: boolean | null;
  providers?: string[];
  subscription?: NanoGptSubscription;
  distillationPolicy?: NanoGptDistillationPolicy;
};

const NANO_GPT_ORIGIN = "https://nano-gpt.com";
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_MODELS = 2_000;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_SAFE_JSON_DEPTH = 5;
const MAX_SAFE_JSON_ENTRIES = 64;
const MAX_SAFE_JSON_STRING_LENGTH = 2_000;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const boundedString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
};

const modelId = (value: unknown) => {
  const id = boundedString(value, MAX_MODEL_ID_LENGTH);
  return id && !/[\s\u0000-\u001f\u007f]/.test(id) ? id : undefined;
};

const nonNegativeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const nullableNonNegativeInteger = (value: unknown) => {
  if (value === null) return null;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
};

const firstPresent = (...values: unknown[]) =>
  values.find((value) => value !== undefined);

const booleanField = (record: UnknownRecord, ...keys: string[]) => {
  const value = firstPresent(...keys.map((key) => record[key]));
  return typeof value === "boolean" ? value : undefined;
};

const boundedIdentifierList = (
  value: unknown,
  { maxItems = 64, maxLength = 80 }: { maxItems?: number; maxLength?: number } = {},
) => {
  if (!Array.isArray(value)) return undefined;
  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, maxItems)) {
    const normalized = boundedString(entry, maxLength)?.toLowerCase();
    if (!normalized || !/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values.length ? values : undefined;
};

const appendUnique = (values: Array<string | undefined>) => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const safeHttpsUrl = (value: unknown, relativeToNanoGpt = false) => {
  const raw = boundedString(value, 2_048);
  if (!raw) return undefined;
  try {
    const parsed = relativeToNanoGpt ? new URL(raw, NANO_GPT_ORIGIN) : new URL(raw);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};

const sanitizeJsonValue = (
  value: unknown,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return value.length <= MAX_SAFE_JSON_STRING_LENGTH ? value : undefined;
  }
  if (depth >= MAX_SAFE_JSON_DEPTH || typeof value !== "object") {
    return undefined;
  }
  if (ancestors.has(value)) return undefined;
  ancestors.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_SAFE_JSON_ENTRIES)
      .map((entry) => sanitizeJsonValue(entry, depth + 1, ancestors))
      .filter((entry) => entry !== undefined);
    ancestors.delete(value);
    return result;
  }

  const record = asRecord(value);
  if (!record) {
    ancestors.delete(value);
    return undefined;
  }
  const result: UnknownRecord = {};
  for (const [key, entry] of Object.entries(record).slice(
    0,
    MAX_SAFE_JSON_ENTRIES,
  )) {
    if (UNSAFE_KEYS.has(key) || !key || key.length > 160) continue;
    const safeEntry = sanitizeJsonValue(entry, depth + 1, ancestors);
    if (safeEntry !== undefined) result[key] = safeEntry;
  }
  ancestors.delete(value);
  return result;
};

const normalizeCapabilities = (
  value: unknown,
): NanoGptChatCapabilities | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const capabilities: NanoGptChatCapabilities = {};
  const mappings = [
    ["vision", ["vision"]],
    ["video_input", ["video_input", "videoInput"]],
    ["audio_input", ["audio_input", "audioInput"]],
    ["reasoning", ["reasoning"]],
    ["tool_calling", ["tool_calling", "toolCalling"]],
    ["parallel_tool_calls", ["parallel_tool_calls", "parallelToolCalls"]],
    ["structured_output", ["structured_output", "structuredOutput"]],
    ["pdf_upload", ["pdf_upload", "pdfUpload"]],
  ] as const;

  for (const [outputKey, inputKeys] of mappings) {
    const value = booleanField(record, ...inputKeys);
    if (value !== undefined) capabilities[outputKey] = value;
  }
  return Object.keys(capabilities).length ? capabilities : undefined;
};

const normalizePricing = (value: unknown): NanoGptChatPricing | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const pricing: NanoGptChatPricing = {};
  const prompt = nonNegativeNumber(record.prompt);
  const completion = nonNegativeNumber(record.completion);
  const cacheReadInputPer1kTokens = nonNegativeNumber(
    firstPresent(
      record.cacheReadInputPer1kTokens,
      record.cache_read_input_per_1k_tokens,
    ),
  );
  const cacheWriteInputPer1kTokens = nonNegativeNumber(
    firstPresent(
      record.cacheWriteInputPer1kTokens,
      record.cache_write_input_per_1k_tokens,
    ),
  );
  const currency = boundedString(record.currency, 20);
  const unit = boundedString(record.unit, 80);
  const note = boundedString(record.note, 1_000);
  if (prompt !== undefined) pricing.prompt = prompt;
  if (completion !== undefined) pricing.completion = completion;
  if (cacheReadInputPer1kTokens !== undefined) {
    pricing.cacheReadInputPer1kTokens = cacheReadInputPer1kTokens;
  }
  if (cacheWriteInputPer1kTokens !== undefined) {
    pricing.cacheWriteInputPer1kTokens = cacheWriteInputPer1kTokens;
  }
  if (currency) pricing.currency = currency;
  if (unit) pricing.unit = unit;
  if (note) pricing.note = note;
  return Object.keys(pricing).length ? pricing : undefined;
};

const normalizeCostEstimate = (value: unknown) => {
  const numeric = nonNegativeNumber(value);
  if (numeric !== undefined) return numeric;
  if (typeof value === "string") return boundedString(value, 80);
  const record = asRecord(value);
  return record ? sanitizeJsonValue(record) : undefined;
};

const normalizeSubscription = (
  value: unknown,
): NanoGptSubscription | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const subscription: NanoGptSubscription = {};
  const included = booleanField(record, "included");
  const inputTokenMultiplier = nonNegativeNumber(
    firstPresent(
      record.inputTokenMultiplier,
      record.input_token_multiplier,
    ),
  );
  const note = boundedString(record.note, 1_000);
  if (included !== undefined) subscription.included = included;
  if (inputTokenMultiplier !== undefined) {
    subscription.inputTokenMultiplier = inputTokenMultiplier;
  }
  if (note) subscription.note = note;
  return Object.keys(subscription).length ? subscription : undefined;
};

const normalizeDistillationPolicy = (
  value: unknown,
): NanoGptDistillationPolicy | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const policy: NanoGptDistillationPolicy = {};
  const status = boundedString(record.status, 80);
  const label = boundedString(record.label, 500);
  const basis = boundedString(record.basis, 160);
  const sourceUrl = safeHttpsUrl(
    firstPresent(record.sourceUrl, record.source_url),
  );
  const note = boundedString(record.note, 2_000);
  if (status) policy.status = status;
  if (label) policy.label = label;
  if (basis) policy.basis = basis;
  if (sourceUrl) policy.sourceUrl = sourceUrl;
  if (note) policy.note = note;
  return Object.keys(policy).length ? policy : undefined;
};

const extractModels = (payload: unknown) => {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  return Array.isArray(root?.data) ? root.data : [];
};

const normalizeModel = (value: unknown): NanoGptChatModel | null => {
  const record = asRecord(value);
  const id = modelId(record?.id);
  if (!record || !id) return null;

  const capabilities = normalizeCapabilities(record.capabilities);
  const pricing = normalizePricing(record.pricing);
  const architecture = asRecord(record.architecture);
  const architectureInputModalities = boundedIdentifierList(
    firstPresent(
      architecture?.input_modalities,
      architecture?.inputModalities,
    ),
  );
  const architectureOutputModalities = boundedIdentifierList(
    firstPresent(
      architecture?.output_modalities,
      architecture?.outputModalities,
    ),
  );
  const modality = boundedString(architecture?.modality, 160);
  const contextWindow = nullableNonNegativeInteger(
    firstPresent(record.context_length, record.contextLength),
  );
  const maxOutputTokens = nullableNonNegativeInteger(
    firstPresent(record.max_output_tokens, record.maxOutputTokens),
  );
  const name = boundedString(record.name, 500);
  const description = boundedString(record.description, 5_000);
  const ownedBy = boundedString(
    firstPresent(record.owned_by, record.ownedBy),
    160,
  );
  const object = record.object === "model" ? "model" : undefined;
  const created = nullableNonNegativeInteger(record.created);
  const iconUrl = safeHttpsUrl(
    firstPresent(record.icon_url, record.iconUrl),
    true,
  );
  const costEstimate = normalizeCostEstimate(
    firstPresent(record.cost_estimate, record.costEstimate),
  );
  const category = boundedString(record.category, 160);
  const providers = boundedIdentifierList(record.providers, {
    maxItems: 128,
    maxLength: 80,
  });
  const subscription = normalizeSubscription(record.subscription);
  const distillationPolicy = normalizeDistillationPolicy(
    firstPresent(record.distillationPolicy, record.distillation_policy),
  );
  const inputModalities = appendUnique([
    ...(architectureInputModalities ?? ["text"]),
    ...(capabilities?.vision === true ? ["image"] : []),
    ...(capabilities?.audio_input === true ? ["audio"] : []),
    ...(capabilities?.video_input === true ? ["video"] : []),
    ...(capabilities?.pdf_upload === true ? ["file"] : []),
  ]);
  const outputModalities = architectureOutputModalities ?? ["text"];

  return {
    id,
    label: name ?? id,
    provider: "nanogpt",
    endpoint: "nanogpt-chat-completions",
    metadataSource: "nanogpt-text-catalog",
    metadataStatus: "known",
    ...(object ? { object } : {}),
    ...(typeof created === "number" ? { created } : {}),
    ...(ownedBy ? { ownedBy } : {}),
    ...(description ? { description } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(modality ? { modality } : {}),
    inputModalities,
    outputModalities,
    ...(capabilities?.vision !== undefined
      ? { supportsVision: capabilities.vision }
      : {}),
    ...(capabilities?.audio_input !== undefined
      ? { supportsAudioInput: capabilities.audio_input }
      : {}),
    ...(capabilities?.video_input !== undefined
      ? { supportsVideoInput: capabilities.video_input }
      : {}),
    ...(capabilities?.tool_calling !== undefined
      ? {
          supportsTools: capabilities.tool_calling,
          supportsFunctionCalling: capabilities.tool_calling,
        }
      : {}),
    ...(capabilities?.reasoning !== undefined
      ? { supportsReasoning: capabilities.reasoning }
      : {}),
    ...(capabilities?.structured_output !== undefined
      ? { supportsJsonMode: capabilities.structured_output }
      : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(pricing ? { pricing } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(costEstimate !== undefined ? { costEstimate } : {}),
    ...(category ? { category } : {}),
    ...(providers ? { providers } : {}),
    ...(subscription ? { subscription } : {}),
    ...(subscription?.included !== undefined
      ? { premium: !subscription.included }
      : {}),
    ...(subscription?.inputTokenMultiplier !== undefined
      ? { tokenMultiplier: subscription.inputTokenMultiplier }
      : {}),
    ...(distillationPolicy ? { distillationPolicy } : {}),
  };
};

export const normalizeNanoGptChatModels = (
  payload: unknown,
): NanoGptChatModel[] => {
  const models: NanoGptChatModel[] = [];
  const seen = new Set<string>();
  for (const entry of extractModels(payload).slice(0, MAX_MODELS)) {
    const model = normalizeModel(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
};

export const normalizeNanoGptChatMeta = (
  payload: unknown,
): UnknownRecord | undefined => {
  const root = asRecord(payload);
  const meta = asRecord(root?.meta);
  const sanitized = meta ? sanitizeJsonValue(meta) : undefined;
  const record = asRecord(sanitized);
  return record && Object.keys(record).length ? record : undefined;
};
