const normalizeValue = (value: string) => value.trim().replace(/\r\n/g, "\n");
const stripOuterQuotes = (value: string) =>
  normalizeValue(value).replace(/^["']|["']$/g, "");
const normalizeComparable = (value: string) =>
  stripOuterQuotes(value).replace(/\s+/g, " ").toLowerCase();

const NEGATIVE_PROMPT_PATTERN =
  /\b(blurry|blur|bad anatomy|bad hands|extra limbs?|extra fingers?|deformed|malformed|mutated|disfigured|watermark|logo|text|caption|signature|low detail|low quality|flat shading|artifact|noise|grainy|duplicate|poorly drawn)\b/i;

const PROMPT_STOP_LABEL_PATTERN =
  /^\s*(?:optional\s+)?(?:negative prompt|video readiness note|audio mood note|image model|model)\s*:/im;

const extractTaggedBlock = (assistantContent: string, labels: string[]) => {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}:\\s*([\\s\\S]*?)(?:\\n(?:final [^\\n:]+|negative prompt|video readiness|audio mood|script|prompt):|\\n\\s*\\n|$)`,
      "i"
    );
    const match = assistantContent.match(pattern);
    if (!match?.[1]) continue;
    const candidate = match[1]
      .replace(/^\s*[-*]\s*/gm, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (candidate.length > 3) {
      return candidate;
    }
  }
  return "";
};

const extractNegativePromptFromAssistant = (assistantContent: string) =>
  extractTaggedBlock(assistantContent, [
    "optional negative prompt",
    "negative prompt",
  ]);

const stripAssistantPreamble = (value: string) =>
  value
    .replace(
      /^\s*(?:let me|i(?:'|’)?ll|i will|here(?:'|’)?s|here is)[^\n]*(?:\n+|$)/i,
      ""
    )
    .trim();

export const extractImagePromptForToolCall = (
  assistantContent: string,
  userPrompt: string
) => {
  const tagged = extractTaggedBlock(assistantContent, [
    "final flux prompt",
    "final image prompt",
    "image prompt",
    "final prompt",
  ]);
  if (tagged) return tagged;

  const beforeMetadata = assistantContent.split(PROMPT_STOP_LABEL_PATTERN)[0] ?? "";
  const cleaned = stripAssistantPreamble(beforeMetadata);
  if (cleaned.length > 20) return cleaned;

  return normalizeValue(userPrompt);
};

export const isLikelyNegativeImagePrompt = (
  prompt: string,
  knownNegativePrompt?: string
) => {
  const normalizedPrompt = normalizeComparable(prompt);
  if (!normalizedPrompt) return false;
  if (
    knownNegativePrompt &&
    normalizedPrompt === normalizeComparable(knownNegativePrompt)
  ) {
    return true;
  }
  if (!NEGATIVE_PROMPT_PATTERN.test(prompt)) return false;
  const commaSeparatedParts = prompt.split(",").filter((part) => part.trim());
  return commaSeparatedParts.length >= 2 && prompt.length < 260;
};

export const repairImageToolArguments = (
  args: Record<string, unknown>,
  {
    assistantContent,
    userPrompt,
  }: {
    assistantContent: string;
    userPrompt: string;
  },
  {
    preferAssistantPrompt = false,
  }: {
    preferAssistantPrompt?: boolean;
  } = {}
) => {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const assistantPrompt = extractImagePromptForToolCall(assistantContent, userPrompt);
  const assistantNegativePrompt = extractNegativePromptFromAssistant(assistantContent);
  const repairedArgs = { ...args };

  const promptIsRawUserText =
    prompt && normalizeComparable(prompt) === normalizeComparable(userPrompt);

  if (
    assistantPrompt &&
    (!prompt ||
      isLikelyNegativeImagePrompt(prompt, assistantNegativePrompt) ||
      (preferAssistantPrompt && promptIsRawUserText))
  ) {
    repairedArgs.prompt = assistantPrompt;
    if (!repairedArgs.negative_prompt && prompt) {
      repairedArgs.negative_prompt = prompt;
    } else if (!repairedArgs.negative_prompt && assistantNegativePrompt) {
      repairedArgs.negative_prompt = assistantNegativePrompt;
    }
  }

  return repairedArgs;
};

export const parseToolArguments = (rawArgs: string) => {
  if (!rawArgs) return {};
  const parsed = JSON.parse(rawArgs);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid tool arguments.");
  }
  return parsed as Record<string, unknown>;
};

export const resolveToolArguments = ({
  toolName,
  rawArgs,
  context,
}: {
  toolName: string;
  rawArgs: string;
  context?: { assistantContent: string; userPrompt: string };
}) => {
  try {
    return { args: parseToolArguments(rawArgs), recovered: false };
  } catch (error) {
    if (toolName === "generate_image" && context) {
      return {
        args: {
          prompt: extractImagePromptForToolCall(
            context.assistantContent,
            context.userPrompt
          ),
        },
        recovered: true,
      };
    }
    throw error;
  }
};

export const extractPromptForFallback = (
  assistantContent: string,
  userPrompt: string
) => {
  const candidate = extractTaggedBlock(assistantContent, [
    "final flux prompt",
    "final image prompt",
    "final video prompt",
    "final prompt",
    "prompt",
  ]);
  return candidate || normalizeValue(userPrompt);
};

export const extractAudioInputForFallback = (
  assistantContent: string,
  userPrompt: string
) => {
  const candidate = extractTaggedBlock(assistantContent, [
    "final script",
    "final narration",
    "final audio input",
    "speech",
    "script",
  ]);
  return candidate || normalizeValue(userPrompt);
};
