const DEFAULT_CHAT_OUTPUT_TOKENS = 4_096;
const TOOL_CHAT_OUTPUT_TOKENS = 16_384;
export const MAX_STUDIO_CHAT_OUTPUT_TOKENS = 32_768;

const MIN_PROMPT_REWRITE_OUTPUT_TOKENS = 8_192;
const MAX_INITIAL_PROMPT_REWRITE_OUTPUT_TOKENS = 16_384;
const MAX_PROMPT_REWRITE_OUTPUT_TOKENS = 32_768;

const finitePositiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.trunc(value))
    : null;

const uniqueBudgets = (values: number[]) =>
  values.filter((value, index) => values.indexOf(value) === index);

export const normalizeStudioChatOutputTokens = (value: unknown) => {
  const parsed = finitePositiveInteger(value);
  return Math.min(
    MAX_STUDIO_CHAT_OUTPUT_TOKENS,
    parsed ?? DEFAULT_CHAT_OUTPUT_TOKENS,
  );
};

export const resolveStudioChatOutputTokenBudgets = ({
  hasTools,
  modelMaxOutputTokens,
}: {
  hasTools: boolean;
  modelMaxOutputTokens?: number | null;
}) => {
  const modelLimit = Math.min(
    finitePositiveInteger(modelMaxOutputTokens) ??
      MAX_STUDIO_CHAT_OUTPUT_TOKENS,
    MAX_STUDIO_CHAT_OUTPUT_TOKENS,
  );
  const initial = Math.min(
    modelLimit,
    hasTools ? TOOL_CHAT_OUTPUT_TOKENS : DEFAULT_CHAT_OUTPUT_TOKENS,
  );
  return uniqueBudgets([initial, modelLimit]);
};

export const resolvePromptRewriteOutputTokenBudgets = (prompt: string) => {
  // A rewrite can be as long as its input. One token per two characters leaves
  // headroom for dense prose, JSON escaping, and reasoning-token accounting.
  const estimatedRewriteBudget = Math.ceil(prompt.length / 2) + 2_048;
  const initial = Math.min(
    MAX_INITIAL_PROMPT_REWRITE_OUTPUT_TOKENS,
    Math.max(MIN_PROMPT_REWRITE_OUTPUT_TOKENS, estimatedRewriteBudget),
  );
  return uniqueBudgets([initial, MAX_PROMPT_REWRITE_OUTPUT_TOKENS]);
};

const asRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isOutputLimitReason = (value: unknown) =>
  typeof value === "string" &&
  /^(?:length|max(?:imum)?[_-]?(?:output[_-]?)?tokens?)$/i.test(
    value.trim(),
  );

export const isOutputTokenLimitReached = (value: unknown): boolean => {
  const record = asRecord(value);
  if (!record) return false;

  if (record.status === "incomplete") {
    const details = asRecord(record.incomplete_details);
    if (!details || isOutputLimitReason(details.reason)) return true;
  }

  const details = asRecord(record.incomplete_details);
  if (isOutputLimitReason(details?.reason)) return true;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  return choices.some((choice) => {
    const choiceRecord = asRecord(choice);
    return isOutputLimitReason(
      choiceRecord?.finish_reason ?? choiceRecord?.finishReason,
    );
  });
};
