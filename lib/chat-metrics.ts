export type ChatTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

type MetricMedia = {
  id?: string;
};

type MetricMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  transient?: boolean;
  images?: MetricMedia[];
  media?: MetricMedia[];
  usage?: ChatTokenUsage;
};

type ChatMetricsInput = {
  messages: MetricMessage[];
  busy: boolean;
  queuedTurns: number;
  providerTokensRemaining?: number | null;
  contextWindow?: number | null;
};

export type ChatMetricsSummary = {
  tokenLabel: "Tokens left" | "Context left" | "Tokens used" | "Context" | "Tokens";
  tokenValue: number | null;
  generatedOutputs: number;
  failedGenerations: number;
  activeWork: number;
  queuedWork: number;
  totalTokensUsed: number;
};

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const messageUsageTotal = (usage?: ChatTokenUsage) => {
  if (finiteNonNegative(usage?.totalTokens)) return usage.totalTokens;
  const input = finiteNonNegative(usage?.inputTokens) ? usage.inputTokens : 0;
  const output = finiteNonNegative(usage?.outputTokens) ? usage.outputTokens : 0;
  return input + output;
};

export const summarizeChatMetrics = ({
  messages,
  busy,
  queuedTurns,
  providerTokensRemaining,
  contextWindow,
}: ChatMetricsInput): ChatMetricsSummary => {
  const generatedIds = new Set<string>();
  let failedGenerations = 0;
  let totalTokensUsed = 0;
  let lastCallTokens: number | null = null;

  for (const message of messages) {
    if (message.transient) continue;
    if (message.role === "assistant") {
      const used = messageUsageTotal(message.usage);
      if (used > 0) {
        totalTokensUsed += used;
        lastCallTokens = used;
      }
    }
    if (message.role !== "tool" || !message.name?.startsWith("generate_")) {
      continue;
    }
    for (const item of [...(message.media ?? []), ...(message.images ?? [])]) {
      if (item.id) generatedIds.add(item.id);
    }
    if (/\b(?:tool error|generation failed|failed:)\b/i.test(message.content ?? "")) {
      failedGenerations += 1;
    }
  }

  let tokenLabel: ChatMetricsSummary["tokenLabel"] = "Tokens";
  let tokenValue: number | null = null;
  if (finiteNonNegative(providerTokensRemaining)) {
    tokenLabel = "Tokens left";
    tokenValue = providerTokensRemaining;
  } else if (finiteNonNegative(contextWindow) && lastCallTokens !== null) {
    tokenLabel = "Context left";
    tokenValue = Math.max(0, contextWindow - lastCallTokens);
  } else if (totalTokensUsed > 0) {
    tokenLabel = "Tokens used";
    tokenValue = totalTokensUsed;
  } else if (finiteNonNegative(contextWindow)) {
    tokenLabel = "Context";
    tokenValue = contextWindow;
  }

  return {
    tokenLabel,
    tokenValue,
    generatedOutputs: generatedIds.size,
    failedGenerations,
    activeWork: busy ? 1 : 0,
    queuedWork: Math.max(0, Math.floor(queuedTurns)),
    totalTokensUsed,
  };
};
