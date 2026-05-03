import {
  AUTO_IMAGE_OPTION,
  type ModelOption,
  type Provider,
} from "./constants.ts";
import type { GeneratedImage } from "./types.ts";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "./chutes-prompts.ts";
import {
  IMAGE_MIME_TYPES,
  dataUrlToInlineData,
  normalizeVeoDuration,
  parseDataUrl,
} from "./studio-validation.ts";

type ActiveJobLike = {
  status: "queued" | "running" | "success" | "error";
};

type NavyImageGenerationInput = {
  model: string;
  prompt: string;
  size?: string;
  numberOfImages?: number;
  quality?: string;
  style?: string;
  imageUrl?: string | string[];
  negativePrompt?: string;
  seed?: number | null;
  seconds?: number;
  sync?: boolean;
  responseFormat?: string;
  aspectRatio?: string;
};

type NavyModelGroups = {
  data: ModelOption[];
  chat: ModelOption[];
  image: ModelOption[];
  video: ModelOption[];
  audio: ModelOption[];
};

type ReferenceImageInput = {
  dataUrl: string;
  role?: string;
};

type SanitizedReferenceImage = {
  dataUrl: string;
  data: string;
  mimeType: string;
  role?: string;
};

type QueueMode = "image" | "video" | "tts";

type QueueJobLike = {
  id: string;
  status: "queued" | "running" | "success" | "error";
  mode: QueueMode;
};

type ImageSizingOptionsInput = {
  imageAspect?: string;
  imageSize?: string;
  navyImageSize?: string;
};

type ImageSizingOptions = {
  aspectRatio?: string;
  imageSize?: string;
  size?: string;
};

type NavyChatImageSizing = {
  aspectRatio?: string;
  size?: string;
};

export const DEFAULT_IMAGE_RETRY_ATTEMPTS = 4;
export const MAX_IMAGE_RETRY_ATTEMPTS = 8;

export const normalizeImageRetryAttempts = (
  value: unknown,
  fallback = DEFAULT_IMAGE_RETRY_ATTEMPTS,
) => {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return fallback;
  }
  return Math.min(MAX_IMAGE_RETRY_ATTEMPTS, Math.floor(numericValue));
};

export const retryAsyncOperation = async <T>({
  maxAttempts,
  run,
  onAttempt,
  onError,
  shouldRetry,
}: {
  maxAttempts: unknown;
  run: (state: { attempt: number; maxAttempts: number }) => Promise<T>;
  onAttempt?: (state: { attempt: number; maxAttempts: number }) => void;
  onError?: (state: {
    attempt: number;
    maxAttempts: number;
    error: unknown;
    final: boolean;
  }) => void;
  shouldRetry?: (error: unknown) => boolean;
}) => {
  const attempts = normalizeImageRetryAttempts(maxAttempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    onAttempt?.({ attempt, maxAttempts: attempts });
    try {
      return await run({ attempt, maxAttempts: attempts });
    } catch (error) {
      lastError = error;
      const final = attempt >= attempts || shouldRetry?.(error) === false;
      onError?.({ attempt, maxAttempts: attempts, error, final });
      if (final) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Operation failed.");
};

const normalizeModalities = (modalities?: string[] | null) =>
  (modalities ?? []).map((value) => value.toLowerCase());

const normalizeEndpoint = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : "";

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

const stripPromptEnvelope = (value: string) =>
  value.trim().replace(/^["']+|["']+$/g, "");

const ensureSentence = (value: string) => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const appendPromptNote = (prompt: string, note: string) => {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return note;
  if (normalizedPrompt.toLowerCase().includes(note.toLowerCase())) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt}\n\n${note}`;
};

const isAutoImageOption = (value?: string) =>
  !value || value === AUTO_IMAGE_OPTION;

const toSectionTitle = (rawLabel: string) => {
  const normalized = rawLabel.trim().toLowerCase();
  if (normalized === "background/setting") return "Background and setting";
  if (normalized === "main character (focus)") return "Main character";
  if (normalized === "hair & makeup") return "Hair and makeup";
  if (normalized === "pose/expression") return "Pose and expression";
  if (normalized === "composition/camera") return "Composition and camera";
  return rawLabel
    .replace(/[()]/g, "")
    .replace(/[/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const NEGATIVE_PROMPT_UPGRADES: Array<[RegExp, string]> = [
  [/\b(blurry|blur|soft focus)\b/i, "sharp focus and crisp detail"],
  [
    /\b(text|caption|lettering|watermark|logo|signature)\b/i,
    "clean surfaces without embedded typography or branding",
  ],
  [
    /\b(extra limbs|extra fingers|bad hands|bad anatomy|deformed)\b/i,
    "coherent anatomy with natural hands and accurate proportions",
  ],
  [
    /\b(low quality|artifact|artifacts|noise|grainy|muddy)\b/i,
    "polished, artifact-free rendering with high clarity",
  ],
];

const ADULT_IMAGE_PROMPT_PATTERN =
  /\b(nsfw|nude|nudity|naked|erotic|boudoir|lingerie|topless|breasts?|nipples?|sexual|sex|sensual|intimate|provocative|seductive)\b/i;
const NAVY_IMAGE_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
  "4:5",
  "5:4",
  "auto",
  "match_input_image",
  "custom",
]);
const NAVY_IMAGE_PIXEL_SIZES = new Set(["1024x1024", "512x512", "768x768"]);
const NAVY_IMAGE_PIXEL_SIZE_PATTERN = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/i;

const parseNavyImagePixelSize = (value: string) => {
  const match = NAVY_IMAGE_PIXEL_SIZE_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
};

export const isGptImage2Model = (model: string) =>
  model.trim().toLowerCase() === "gpt-image-2";

export const isValidNavyImagePixelSize = (value: string) =>
  Boolean(parseNavyImagePixelSize(value));

export const isValidGptImage2Size = (value: string) => {
  if (isAutoImageOption(value)) return true;
  const parsed = parseNavyImagePixelSize(value);
  if (!parsed) return false;
  const { width, height } = parsed;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;
  return (
    longEdge <= 3840 &&
    width % 16 === 0 &&
    height % 16 === 0 &&
    longEdge / shortEdge <= 3 &&
    totalPixels >= 655_360 &&
    totalPixels <= 8_294_400
  );
};

export const isImagenModel = (model: string) => model.startsWith("imagen-");

const isOpenAiImageModel = (model: string) =>
  /\b(gpt-image-|dall-e-)/i.test(model);

const isGeminiNativeImageModel = (model: string) => {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("nano-banana") ||
    (normalized.includes("gemini-") &&
      (normalized.includes("flash-image") || normalized.includes("pro-image")))
  );
};

const isGeminiImagePolicyModel = (model: string) => {
  const normalized = model.toLowerCase();
  return (
    isGeminiNativeImageModel(model) ||
    isImagenModel(normalized) ||
    normalized.includes("/imagen-")
  );
};

const isLikelyAdultImagePrompt = (prompt: string) =>
  ADULT_IMAGE_PROMPT_PATTERN.test(prompt);

const POLICY_SENSITIVE_IMAGE_PROMPT_PATTERN =
  /\b(J-cup|hard\s+nipples?|crotch|heaving\s+chest|pleading\s+(?:wide\s+)?eyes|masked\s+man|non-?consensual|very\s+large\s+bust|apparent\s+age\s+18|18[-\s]?year[-\s]?old|student\s+council|school\s+uniform|slim\s+yet\s+curvy|curvy\s+build|dilated\s+pupils?|vacant\s+(?:eyes|gaze)|glassy\s+eyes?)\b/i;

const isPolicySensitiveImagePrompt = (prompt: string) =>
  isLikelyAdultImagePrompt(prompt) ||
  POLICY_SENSITIVE_IMAGE_PROMPT_PATTERN.test(prompt);

export const supportsSaferImagePromptRetry = (model: string) =>
  isOpenAiImageModel(model) || isGeminiImagePolicyModel(model);

const softenPolicySensitiveImagePrompt = (prompt: string) => {
  const softened = normalizeWhitespace(stripPromptEnvelope(prompt))
    .replace(
      /\bapparent\s+age\s+18\b/gi,
      "clearly adult university-age appearance",
    )
    .replace(
      /\b(?:apparently|about|around)\s+18(?:\s*years?\s*old)?\b/gi,
      "clearly adult",
    )
    .replace(/\b18[-\s]?year[-\s]?old\b/gi, "clearly adult")
    .replace(/\bstudent council room\b/gi, "university council room")
    .replace(/\bstudent council\b/gi, "university council")
    .replace(/\bhigh school\b/gi, "university")
    .replace(/\bschool uniform\b/gi, "formal academy-inspired blazer outfit")
    .replace(/\bslim\s+yet\s+curvy\b/gi, "slim, balanced")
    .replace(/\bcurvy\s+build\b/gi, "balanced build")
    .replace(/\bcurvy\b/gi, "balanced")
    .replace(/\bdilated\s+pupils?\b/gi, "soft blue eyes")
    .replace(/\bvacant\s+(?:eyes|gaze)\b/gi, "reflective gaze")
    .replace(/\bvacant\b/gi, "reflective")
    .replace(/\bglassy\s+eyes?\b/gi, "bright eyes")
    .replace(/\bglassy\b/gi, "bright")
    .replace(
      /\bmassive\s+heavy\s+J-cup\s+breasts\s+straining\s+against\s+(?:her|their)\s+top\b/gi,
      "an athletic curvy figure in fitted activewear",
    )
    .replace(
      /\ba\s+(?:very\s+large|large)\s+bust\b/gi,
      "an athletic curvy figure",
    )
    .replace(/\b(?:very\s+large|large)\s+bust\b/gi, "athletic curvy figure")
    .replace(/\bmassive\s+heavy\s+breasts?\b/gi, "athletic curvy figure")
    .replace(/\bJ-cup\s+breasts?\b/gi, "curvy upper body")
    .replace(
      /\bhard\s+nipples?\s+poking\s+through\s+(?:her|their)\s+top\b/gi,
      "subtle fabric texture",
    )
    .replace(
      /\bhard\s+nipples?\s+faintly\s+outlined\s+through\s+(?:her|their)\s+top\b/gi,
      "subtle fabric texture",
    )
    .replace(/\bhard\s+nipples?\b/gi, "subtle fabric texture")
    .replace(
      /\b(?:slight\s+)?darkened\s+patch\s+at\s+the\s+crotch\b/gi,
      "natural fabric shading",
    )
    .replace(/\bcrotch\b/gi, "leggings fabric")
    .replace(
      /\bclutching\s+a\s+small\s+gym\s+bag\s+to\s+(?:her|their)\s+heaving\s+chest\b/gi,
      "holding a small gym bag close",
    )
    .replace(/\bto\s+(?:her|their)\s+heaving\s+chest\b/gi, "held close")
    .replace(/\bheaving\s+chest\b/gi, "upper body")
    .replace(/\bpleading\s+(?:wide\s+)?eyes\b/gi, "wide expressive eyes")
    .replace(/\bmasked\s+man\b/gi, "mysterious figure")
    .replace(/\bnon-?consensual\b/gi, "consensual");

  return appendPromptNote(
    softened,
    "Safety preflight: Reframe as a policy-compliant tasteful editorial anime illustration with clearly adult subjects, non-explicit styling, consensual/non-threatening staging, and no graphic sexual focus.",
  );
};

export const isLikelyImagePolicyError = (message: string) =>
  /\b(policy|safety|safe|blocked|flagged|prohibited|moderation|filtered|responsibleai|violation|unsafe)\b/i.test(
    message,
  );

const IMAGE_POLICY_CATEGORIES = [
  "sexual/minors",
  "sexual",
  "violence/graphic",
  "violence",
  "self-harm/instructions",
  "self-harm/intent",
  "self-harm",
  "harassment/threatening",
  "harassment",
  "hate/threatening",
  "hate",
  "illicit/violent",
  "illicit",
] as const;

const IMAGE_POLICY_CATEGORY_GUIDANCE: Record<string, string> = {
  sexual:
    "remove sexual arousal framing, explicit sexual activity, fetishized anatomy, eroticized posing, and intimate body-part focus",
  "sexual/minors":
    "remove any sexualization and any age ambiguity; use clearly adult subjects only when people are relevant",
  violence:
    "remove depictions of injury, death, gore, or physical harm while preserving cinematic tension through lighting and composition",
  "violence/graphic":
    "remove gore, wounds, blood detail, dismemberment, and graphic injury while preserving non-graphic cinematic atmosphere",
  "self-harm":
    "remove self-harm depiction or encouragement while preserving mood through safe visual symbolism",
  "self-harm/intent":
    "remove intent to self-harm and show a safe, supported scene instead",
  "self-harm/instructions":
    "remove instructions or actionable self-harm details entirely",
  harassment:
    "remove harassing or demeaning language while preserving neutral character dynamics",
  "harassment/threatening":
    "remove threats and violent intimidation while preserving non-threatening dramatic tension",
  hate: "remove hateful references to protected traits while preserving neutral worldbuilding details",
  "hate/threatening":
    "remove hateful threats and protected-class targeting while preserving non-hateful conflict only if needed",
  illicit:
    "remove instructions or facilitation of illicit acts while preserving lawful scene context",
  "illicit/violent":
    "remove violent illicit instructions, weapons procurement, or facilitation details while preserving safe visual context",
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const extractImagePolicyViolationCategories = (message: string) => {
  const categories = new Set<string>();
  const lowered = message.toLowerCase();
  for (const match of lowered.matchAll(
    /(?:safety_violations|policy_violations|violations|categories)\s*[:=]\s*\[([^\]]+)\]/g,
  )) {
    const rawCategories = match[1] ?? "";
    for (const rawCategory of rawCategories.split(/[,|]/)) {
      const category = rawCategory.replace(/['"`]/g, "").trim();
      if (IMAGE_POLICY_CATEGORIES.includes(category as typeof IMAGE_POLICY_CATEGORIES[number])) {
        categories.add(category);
      }
    }
  }

  for (const category of IMAGE_POLICY_CATEGORIES) {
    const pattern = new RegExp(`(^|[^a-z0-9_/-])${escapeRegExp(category)}([^a-z0-9_/-]|$)`, "i");
    if (pattern.test(message)) {
      categories.add(category);
    }
  }

  return Array.from(categories);
};

export const buildImagePolicyRecoveryPrompt = ({
  model,
  prompt,
  errorMessage,
  nextAttempt,
  maxAttempts,
}: {
  model: string;
  prompt: string;
  errorMessage: string;
  nextAttempt: number;
  maxAttempts: number;
}) => {
  const categories = extractImagePolicyViolationCategories(errorMessage);
  const categoryLabel = categories.length ? categories.join(", ") : "unknown";
  const categoryGuidance = categories
    .map((category) => IMAGE_POLICY_CATEGORY_GUIDANCE[category])
    .filter(Boolean);
  const normalizedPrompt = normalizeWhitespace(stripPromptEnvelope(prompt));
  const saferPrompt = supportsSaferImagePromptRetry(model)
    ? buildSaferImagePromptForModel(model, normalizedPrompt)
    : normalizedPrompt;

  return `Rewrite this image prompt for ${model} after a provider safety rejection (try ${nextAttempt}/${maxAttempts}).
Flagged moderation categories: ${categoryLabel}.
${categoryGuidance.length ? `Category-specific changes: ${categoryGuidance.join("; ")}.` : "Remove any likely unsafe, explicit, graphic, coercive, minor-related, or prohibited details."}

Preserve the art medium, genre, setting, composition, named subject identity, age/adult context, lighting, camera/framing, palette, mood, and quality level.
When clothing or swimwear is part of the scene, preserve its non-explicit visual role, color, and context while making it properly fitting and removing fabric-strain or body-part focus.
Remove or neutralize the unsafe parts without replacing the requested style with a generic safe image.
Return only the final rewritten image prompt. Do not mention policy, moderation, safety systems, provider errors, blocked categories, or request IDs in the final prompt.

Prompt to rewrite:
${saferPrompt}`;
};

export const resolveImagePromptRecoveryChatModels = ({
  provider,
  activeModel,
}: {
  provider: string;
  activeModel: string;
}) => {
  const candidates =
    provider === "navy"
      ? ["gpt-4o", "deepseek-v4-flash", "glm-5.1-venice", activeModel]
      : [activeModel];
  const seen = new Set<string>();
  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    });
};

export const buildSaferImagePromptForModel = (
  model: string,
  prompt: string,
) => {
  const normalizedPrompt = normalizeWhitespace(stripPromptEnvelope(prompt));
  if (!supportsSaferImagePromptRetry(model)) return normalizedPrompt;

  const saferPrompt = isPolicySensitiveImagePrompt(normalizedPrompt)
    ? softenPolicySensitiveImagePrompt(normalizedPrompt)
    : normalizedPrompt;
  const policyNote = isOpenAiImageModel(model)
    ? "Safety recovery: Rewrite this as a policy-compliant OpenAI image prompt. Preserve the user's lawful visual intent, but remove or soften any explicit sexual, graphic, non-consensual, minor-related, deceptive likeness, or otherwise disallowed details. Use clearly adult subjects only when people are relevant, and prefer tasteful editorial styling over explicit depiction."
    : "Safety recovery: Rewrite this as a policy-compliant Gemini image prompt. Preserve the user's lawful visual intent, but respect Gemini built-in safety filtering, avoid sexually explicit output, avoid any child-safety risk, and remove or soften details likely to trigger prohibited-content or image-safety blocks.";

  return appendPromptNote(saferPrompt, policyNote);
};

const buildFluxQualityGuidance = (negativePrompt?: string) => {
  const positiveTargets = new Set<string>([
    "crisp fine details",
    "coherent anatomy",
    "readable silhouettes",
    "polished surfaces",
    "artifact-free rendering",
  ]);

  if (negativePrompt?.trim()) {
    for (const [pattern, upgrade] of NEGATIVE_PROMPT_UPGRADES) {
      if (pattern.test(negativePrompt)) {
        positiveTargets.add(upgrade);
      }
    }
  }

  return `Desired qualities: ${Array.from(positiveTargets).join(", ")}.`;
};

const isPreparedFluxPrompt = (prompt: string) =>
  /\bDesired qualities:\s*/i.test(prompt) &&
  /\b(crisp fine details|coherent anatomy|artifact-free rendering)\b/i.test(
    prompt,
  );

export const buildFluxImagePrompt = (
  prompt: string,
  negativePrompt?: string,
) => {
  const normalized = normalizeWhitespace(prompt);
  if (!normalized) return buildFluxQualityGuidance(negativePrompt);

  const sections = normalized
    .split("\n")
    .map((line, index) => {
      const match = /^([A-Za-z][A-Za-z0-9/&() \-]+):(.*)$/.exec(line);
      if (!match) {
        const trimmed = line.trim();
        if (index === 0) {
          return ensureSentence(
            `Artwork direction: ${trimmed.replace(/^create\s+/i, "").trim()}`,
          );
        }
        return ensureSentence(trimmed);
      }

      const [, rawLabel, rawValue] = match;
      const value = rawValue.trim();
      if (!value) return "";
      return ensureSentence(`${toSectionTitle(rawLabel)}: ${value}`);
    })
    .filter(Boolean);

  sections.push(buildFluxQualityGuidance(negativePrompt));
  return sections.join("\n\n");
};

export const prepareImagePromptForModel = (
  model: string,
  prompt: string,
  negativePrompt?: string,
) => {
  const rawPrompt = prompt.trim().replace(/\r\n/g, "\n");
  const normalizedPrompt = normalizeWhitespace(stripPromptEnvelope(prompt));
  const trimmedNegativePrompt = negativePrompt?.trim() || undefined;

  if (!isFluxModel(model)) {
    return {
      prompt: normalizedPrompt,
      negativePrompt: trimmedNegativePrompt,
    };
  }

  const fluxPrompt = isPreparedFluxPrompt(rawPrompt)
    ? rawPrompt
    : buildFluxImagePrompt(normalizedPrompt, trimmedNegativePrompt);
  return {
    prompt: fluxPrompt,
    negativePrompt: undefined,
  };
};

export type PreparedImageModelRequest = {
  model: string;
  body: Record<string, unknown>;
  prompt: string;
};

export const prepareImageModelRequests = ({
  models,
  baseBody,
  prompt,
  negativePrompt,
  includeNegativePrompt = true,
}: {
  models: string[];
  baseBody: Record<string, unknown>;
  prompt: string;
  negativePrompt?: string;
  includeNegativePrompt?: boolean;
}): PreparedImageModelRequest[] =>
  models.map((model) => {
    const prepared = prepareImagePromptForModel(model, prompt, negativePrompt);
    return {
      model,
      prompt: prepared.prompt,
      body: {
        ...baseBody,
        model,
        prompt: prepared.prompt,
        ...(includeNegativePrompt && prepared.negativePrompt
          ? { negativePrompt: prepared.negativePrompt }
          : {}),
      },
    };
  });

export const summarizeImageModelPrompts = (
  requests: Pick<PreparedImageModelRequest, "model" | "prompt">[],
) => {
  const uniquePrompts = Array.from(
    new Set(requests.map((request) => request.prompt).filter(Boolean)),
  );
  if (uniquePrompts.length <= 1) {
    return uniquePrompts[0] ?? "";
  }
  return requests
    .map((request) => `${request.model}:\n${request.prompt}`)
    .join("\n\n");
};

export const resolveImageSizingOptions = (
  provider: Provider,
  { imageAspect, imageSize, navyImageSize }: ImageSizingOptionsInput,
): ImageSizingOptions => {
  const sizing: ImageSizingOptions = {};

  if (
    (provider === "gemini" ||
      provider === "openrouter" ||
      provider === "navy") &&
    !isAutoImageOption(imageAspect)
  ) {
    sizing.aspectRatio = imageAspect;
  }

  if (
    (provider === "gemini" || provider === "openrouter") &&
    !isAutoImageOption(imageSize)
  ) {
    sizing.imageSize = imageSize;
  }

  if (provider === "navy" && !isAutoImageOption(navyImageSize)) {
    sizing.size = navyImageSize;
  }

  return sizing;
};

export const resolveNavyChatImageSizing = (
  value: string,
): NavyChatImageSizing => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return {};
  if (NAVY_IMAGE_ASPECT_RATIOS.has(normalized)) {
    return { aspectRatio: normalized };
  }
  if (
    NAVY_IMAGE_PIXEL_SIZES.has(normalized) ||
    isValidNavyImagePixelSize(normalized)
  ) {
    return { size: normalized };
  }
  return {};
};

const sanitizeReferenceImages = (
  referenceImages?: ReferenceImageInput[],
  maxItems = 10,
): SanitizedReferenceImage[] =>
  (referenceImages ?? [])
    .map<SanitizedReferenceImage | null>((reference) => {
      const parsed = parseDataUrl(reference.dataUrl, IMAGE_MIME_TYPES);
      if (!parsed) return null;
      return {
        dataUrl: parsed.dataUrl,
        data: parsed.data,
        mimeType: parsed.mimeType,
        ...(reference.role ? { role: reference.role } : {}),
      };
    })
    .filter(
      (reference): reference is SanitizedReferenceImage => reference !== null,
    )
    .slice(0, maxItems);

export const buildGeminiImagePayload = ({
  model,
  prompt,
  aspectRatio,
  imageSize,
  numberOfImages,
  referenceImages,
}: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  numberOfImages?: number;
  referenceImages?: ReferenceImageInput[];
}) => {
  const preparedPrompt = prepareImagePromptForModel(model, prompt);

  if (isImagenModel(model)) {
    return {
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
      payload: {
        instances: [{ prompt: preparedPrompt.prompt }],
        parameters: {
          sampleCount: numberOfImages ?? 1,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(imageSize ? { imageSize } : {}),
        },
      },
    };
  }

  const parts: Array<Record<string, unknown>> = [
    { text: preparedPrompt.prompt },
  ];
  for (const reference of sanitizeReferenceImages(referenceImages)) {
    parts.push({
      inline_data: {
        mime_type: reference.mimeType,
        data: reference.data,
      },
    });
  }

  return {
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    payload: {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(aspectRatio || imageSize
          ? {
              imageConfig: {
                ...(aspectRatio ? { aspectRatio } : {}),
                ...(imageSize ? { imageSize } : {}),
              },
            }
          : {}),
      },
    },
  };
};

export const buildOpenRouterImagePayload = ({
  model,
  prompt,
  aspectRatio,
  imageSize,
  outputModalities,
  referenceImages,
}: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  outputModalities?: string[];
  referenceImages?: ReferenceImageInput[];
}) => {
  const modalities = resolveOpenRouterModalities(model, outputModalities);
  const preparedPrompt = prepareImagePromptForModel(model, prompt);
  const references = sanitizeReferenceImages(referenceImages);
  const content = references.length
    ? [
        { type: "text", text: preparedPrompt.prompt },
        ...references.map((reference) => ({
          type: "image_url",
          image_url: { url: reference.dataUrl },
        })),
      ]
    : preparedPrompt.prompt;

  return {
    model,
    messages: [{ role: "user", content }],
    modalities,
    ...(aspectRatio || imageSize
      ? {
          image_config: {
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(imageSize ? { image_size: imageSize } : {}),
          },
        }
      : {}),
  };
};

const toVeoInlineImage = (dataUrl?: string | null) => {
  if (!dataUrl) return null;
  const inlineData = dataUrlToInlineData(dataUrl);
  if (!inlineData) return null;
  return {
    inlineData: {
      mimeType: inlineData.inlineData.mimeType,
      data: inlineData.inlineData.data,
    },
  };
};

export const buildGeminiVideoPayload = ({
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
  negativePrompt,
  sourceImage,
  lastFrameImage,
  referenceImages,
}: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: string;
  negativePrompt?: string;
  sourceImage?: string | null;
  lastFrameImage?: string | null;
  referenceImages?: ReferenceImageInput[];
}) => {
  const image = toVeoInlineImage(sourceImage);
  const lastFrame = toVeoInlineImage(lastFrameImage);
  const referenceImageParts = sanitizeReferenceImages(referenceImages, 3)
    .filter(
      (reference) =>
        reference.role !== "source_image" &&
        reference.role !== "first_frame" &&
        reference.role !== "last_frame",
    )
    .slice(0, 3)
    .map((reference) => ({
      image: {
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.data,
        },
      },
      referenceType: reference.role === "style" ? "style" : "asset",
    }));
  const normalizedDuration = normalizeVeoDuration(durationSeconds, {
    resolution,
    hasReferenceImages: referenceImageParts.length > 0,
    hasLastFrame: Boolean(lastFrame),
  });

  return {
    instances: [
      {
        prompt,
        ...(image ? { image } : {}),
        ...(lastFrame ? { lastFrame } : {}),
        ...(referenceImageParts.length
          ? { referenceImages: referenceImageParts }
          : {}),
      },
    ],
    parameters: {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      durationSeconds: normalizedDuration,
      ...(negativePrompt ? { negativePrompt } : {}),
    },
  };
};

export const getActiveJobCount = (jobs: ActiveJobLike[]) =>
  jobs.filter((job) => job.status === "queued" || job.status === "running")
    .length;

export const isFluxModel = (model: string) =>
  /(^|[/:.-])flux([/:.-]|$)/i.test(model);

export const resolveOpenRouterModalities = (
  model: string,
  outputModalities?: string[],
) => {
  const normalized = normalizeModalities(outputModalities);
  if (normalized.includes("image") && !normalized.includes("text")) {
    return ["image"];
  }
  if (normalized.includes("image") && normalized.includes("text")) {
    return ["image", "text"];
  }
  return isFluxModel(model) ? ["image"] : ["image", "text"];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const firstPresent = (...values: unknown[]) =>
  values.find((value) => value !== undefined);

const nullableNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : value === null
      ? null
      : undefined;

const nullableBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : value === null ? null : undefined;

const nullableString = (value: unknown) =>
  typeof value === "string" ? value : value === null ? null : undefined;

const nullableStringArray = (value: unknown) => {
  if (value === null) return null;
  const values = asArray(value).filter(
    (entry): entry is string => typeof entry === "string",
  );
  return values.length ? values : undefined;
};

const setNullable = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (value !== undefined) {
    target[key] = value;
  }
};

const pushUniqueModel = (list: ModelOption[], model: ModelOption) => {
  if (!list.some((entry) => entry.id === model.id)) {
    list.push(model);
  }
};

const NAVY_VIDEO_MODEL_PATTERN =
  /\b(veo|cogvideo|kling|hunyuan|wan|minimax|luma|runway|video)\b/i;
const NAVY_TTS_MODEL_PATTERN =
  /(^|[/:._-])(tts|eleven|voice)([/:._-]|$)|gemini-.*tts/i;
const NAVY_TRANSCRIPTION_MODEL_PATTERN = /\b(whisper|transcribe|scribe)\b/i;

const toModelOption = (value: unknown): ModelOption | null => {
  const record = asRecord(value);
  if (!record) return null;

  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;

  const label =
    typeof record.name === "string"
      ? record.name
      : typeof record.label === "string"
        ? record.label
        : id;
  const architecture = asRecord(record.architecture);
  const outputModalities = nullableStringArray(
    firstPresent(
      record.output_modalities,
      record.outputModalities,
      architecture?.output_modalities,
    ),
  );
  const inputModalities = nullableStringArray(
    firstPresent(
      record.input_modalities,
      record.inputModalities,
      architecture?.input_modalities,
    ),
  );
  const endpoint =
    typeof record.endpoint === "string" ? record.endpoint : undefined;
  const provider =
    typeof record.owned_by === "string"
      ? record.owned_by
      : typeof record.provider === "string"
        ? record.provider
        : undefined;
  const premium =
    typeof record.premium === "boolean" ? record.premium : undefined;
  const requiredPlan =
    typeof record.required_plan === "string"
      ? record.required_plan
      : typeof record.requiredPlan === "string"
        ? record.requiredPlan
        : record.required_plan === null || record.requiredPlan === null
          ? null
          : undefined;
  const tokenMultiplier =
    typeof record.token_multiplier === "number"
      ? record.token_multiplier
      : typeof record.tokenMultiplier === "number"
        ? record.tokenMultiplier
        : undefined;
  const pricing = record.pricing;
  const contextWindow = nullableNumber(
    firstPresent(record.context_window, record.contextWindow),
  );
  const maxOutputTokens = nullableNumber(
    firstPresent(record.max_output_tokens, record.maxOutputTokens),
  );
  const modality = nullableString(record.modality);
  const tokenizer = nullableString(record.tokenizer);
  const description = nullableString(record.description);
  const metadataSource = nullableString(
    firstPresent(record.metadata_source, record.metadataSource),
  );
  const metadataStatus =
    typeof record.metadata_status === "string"
      ? record.metadata_status
      : typeof record.metadataStatus === "string"
        ? record.metadataStatus
        : undefined;
  const supportsVision = nullableBoolean(
    firstPresent(record.supports_vision, record.supportsVision),
  );
  const supportsTools = nullableBoolean(
    firstPresent(record.supports_tools, record.supportsTools),
  );
  const supportsFunctionCalling = nullableBoolean(
    firstPresent(
      record.supports_function_calling,
      record.supportsFunctionCalling,
    ),
  );
  const supportsReasoning = nullableBoolean(
    firstPresent(record.supports_reasoning, record.supportsReasoning),
  );
  const supportsJsonMode = nullableBoolean(
    firstPresent(record.supports_json_mode, record.supportsJsonMode),
  );
  const supportsAudioInput = nullableBoolean(
    firstPresent(record.supports_audio_input, record.supportsAudioInput),
  );
  const supportsImageOutput = nullableBoolean(
    firstPresent(record.supports_image_output, record.supportsImageOutput),
  );
  const supportsStreaming = nullableBoolean(
    firstPresent(record.supports_streaming, record.supportsStreaming),
  );

  const model: ModelOption & Record<string, unknown> = {
    id,
    label,
    ...(provider ? { provider } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
    ...(outputModalities !== undefined ? { outputModalities } : {}),
    ...(typeof premium === "boolean" ? { premium } : {}),
    ...(requiredPlan !== undefined ? { requiredPlan } : {}),
    ...(typeof tokenMultiplier === "number" ? { tokenMultiplier } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
  };

  setNullable(model, "contextWindow", contextWindow);
  setNullable(model, "maxOutputTokens", maxOutputTokens);
  setNullable(model, "modality", modality);
  setNullable(model, "tokenizer", tokenizer);
  setNullable(model, "description", description);
  setNullable(model, "metadataSource", metadataSource);
  setNullable(model, "metadataStatus", metadataStatus);
  setNullable(model, "supportsVision", supportsVision);
  setNullable(model, "supportsTools", supportsTools);
  setNullable(model, "supportsFunctionCalling", supportsFunctionCalling);
  setNullable(model, "supportsReasoning", supportsReasoning);
  setNullable(model, "supportsJsonMode", supportsJsonMode);
  setNullable(model, "supportsAudioInput", supportsAudioInput);
  setNullable(model, "supportsImageOutput", supportsImageOutput);
  setNullable(model, "supportsStreaming", supportsStreaming);

  return model;
};

export const extractOpenRouterImageModels = (
  payload: unknown,
): ModelOption[] => {
  const rawModels = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.data);

  return rawModels.map(toModelOption).filter((entry): entry is ModelOption => {
    if (!entry) return false;
    const modalities = normalizeModalities(entry.outputModalities);
    if (!modalities.length) return true;
    return modalities.includes("image");
  });
};

export const groupNavyModelsByCapability = (
  payload: unknown,
): NavyModelGroups => {
  const rawModels = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload)?.data ?? payload);

  return rawModels.reduce<NavyModelGroups>(
    (groups, entry) => {
      const record = asRecord(entry);
      const model = toModelOption(entry);
      if (!record || !model) return groups;
      pushUniqueModel(groups.data, model);

      const endpoint = normalizeEndpoint(record.endpoint);
      const id = model.id.toLowerCase();

      if (
        endpoint.includes("/v1/chat/completions") ||
        endpoint.includes("/v1/messages") ||
        endpoint.includes("/v1/responses")
      ) {
        pushUniqueModel(groups.chat, {
          ...model,
          supports: { ...(model.supports ?? {}) },
        });
        return groups;
      }

      if (
        endpoint.includes("/v1/audio/speech") ||
        (!endpoint &&
          NAVY_TTS_MODEL_PATTERN.test(id) &&
          !NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id))
      ) {
        pushUniqueModel(groups.audio, {
          ...model,
          supports: { ...(model.supports ?? {}), tts: true },
        });
        return groups;
      }

      if (
        endpoint.includes("/v1/videos/generations") ||
        endpoint.includes("/videos/generations")
      ) {
        pushUniqueModel(groups.video, {
          ...model,
          supports: {
            ...(model.supports ?? {}),
            video: true,
            asyncJobs: true,
            sourceImage: true,
            referenceImages: true,
            aspectRatio: true,
            negativePrompt: true,
          },
          maxReferenceImages: 5,
        });
        return groups;
      }

      if (
        endpoint.includes("/v1/images/generations") ||
        endpoint.includes("/images/generations") ||
        !endpoint
      ) {
        if (NAVY_VIDEO_MODEL_PATTERN.test(id)) {
          pushUniqueModel(groups.video, {
            ...model,
            supports: {
              ...(model.supports ?? {}),
              video: true,
              asyncJobs: true,
              sourceImage: true,
              referenceImages: true,
              aspectRatio: true,
              negativePrompt: true,
            },
            maxReferenceImages: 5,
          });
        } else if (!NAVY_TRANSCRIPTION_MODEL_PATTERN.test(id)) {
          pushUniqueModel(groups.image, {
            ...model,
            supports: {
              ...(model.supports ?? {}),
              imageGeneration: true,
              sourceImage: true,
              referenceImages: true,
              aspectRatio: true,
              size: true,
              seed: true,
            },
            maxReferenceImages: 5,
          });
        }
      }

      return groups;
    },
    { data: [], chat: [], image: [], video: [], audio: [] },
  );
};

export const resolveImageGenerationModelPipeline = (
  preferredModels: string[],
  fallbackModel: string,
  availableModels: string[],
) => {
  const allowed = new Set(availableModels);
  const ordered: string[] = [];

  for (const model of preferredModels) {
    if (!allowed.has(model) || ordered.includes(model)) continue;
    ordered.push(model);
  }

  if (!ordered.length && allowed.has(fallbackModel)) {
    ordered.push(fallbackModel);
  }

  return ordered;
};

export const normalizeImageModelOrder = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const order: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const model = value.trim();
    if (!model || order.includes(model)) continue;
    order.push(model);
  }

  return order;
};

export const resolveActiveImageToolModels = ({
  pipelineEnabled,
  preferredModels,
  fallbackModel,
  availableModels,
}: {
  pipelineEnabled: boolean;
  preferredModels: string[];
  fallbackModel: string;
  availableModels: string[];
}) =>
  resolveImageGenerationModelPipeline(
    pipelineEnabled ? preferredModels : [],
    fallbackModel,
    availableModels,
  );

const STRICT_IMAGE_MODEL_VISUAL_REPHRASE_GUIDANCE = `For OpenAI GPT Image and Gemini Nano Banana models, always rephrase the image prompt before calling generate_image. Preserve the user's image intent while removing or softening offending, disallowed, non-visual, or unsupported parts.
For any human subject, state "adult woman in her mid-20s" or "adult man in his mid-20s" early when age is relevant, and use tasteful artistic framing such as "tasteful artistic illustration", "vibrant intricate anime style", or "glamorous editorial artwork".
For Nano Banana models, be especially conservative: avoid repeated emphasis on bust, breasts, cleavage, wide hips, body-hugging fabric, submission, eroticism, seductive framing, BDSM-coded collars, or explicit arching poses. Replace them with safer visible wording such as "pronounced hourglass silhouette", "fitted outfit that follows the figure", "confident presentation", "glamorous poise", "warm amusement", "teasing smirk", "playful fondness", "intimate domestic mood", or "artistically charged atmosphere".
If another person appears in an intimate or tense scene, prefer a silhouetted, distant, or partially visible figure unless the user explicitly needs that person as the main subject. Avoid describing coercion, explicit sexual focus, or direct physical interaction as the center of the still image.
Keep only details that can be shown visually: subject, setting, composition, pose, clothing, objects, lighting, colors, style, mood, camera angle, background, symbols, readable text, and layout.
Ignore or convert anything that is not directly visual:
- Do not ask the image to speak, explain, argue, think, or teach.
- Do not include hidden meanings unless they can be represented through visible symbols, expressions, gestures, or scene design.
- Do not follow instructions meant for audio, animation, interaction, or behavior over time unless they can be shown in a single still frame.
- Do not render long paragraphs of text inside the image.
- Do not include unnecessary labels, captions, names, or UI text unless explicitly requested.
- If a person, organization, product, or project name is mentioned, treat it as context, not mandatory visible text, unless the prompt says to write that exact name in the image.
- If exact text is requested, render it exactly as written and keep it short, clear, and legible.
- If a concept is abstract, translate it into a strong visual metaphor instead of literal explanation.
Prioritize a clean, coherent, visually rich image. Remove clutter, non-visual instructions, backend notes, explanations, and anything the image model cannot actually depict. Do not try to bypass provider moderation; if the request cannot be safely rephrased, ask for a safer visual direction.`;

export const buildProviderPolicyHintForImageModels = (models: string[]) => {
  const hints: string[] = [];
  if (
    models.some(
      (model) => isOpenAiImageModel(model) || isGeminiNativeImageModel(model),
    )
  ) {
    hints.push(STRICT_IMAGE_MODEL_VISUAL_REPHRASE_GUIDANCE);
  }
  if (models.some(isOpenAiImageModel)) {
    hints.push(
      "For OpenAI GPT Image models, preserve lawful adult intent and concrete visual details while adding artistic direction, but keep prompts policy-compliant: consenting adults only when adult themes are relevant, and never include minors, non-consensual sexual content, sexual violence, or deceptive likeness abuse.",
    );
  }
  if (models.some(isGeminiNativeImageModel)) {
    hints.push(
      "For Gemini Nano Banana models, preserve lawful adult intent and concrete visual details while adding painterly art direction, but respect Gemini safety settings for sexually explicit content and the built-in child safety protections.",
    );
  }
  return hints.join("\n");
};

export const getQueuedJobsToStart = (
  jobs: QueueJobLike[],
  {
    maxConcurrentImageJobs = 3,
    maxConcurrentNonImageJobs = 1,
    activeIds = [],
  }: {
    maxConcurrentImageJobs?: number;
    maxConcurrentNonImageJobs?: number;
    activeIds?: string[];
  } = {},
) => {
  const activeSet = new Set(activeIds);
  let availableImageSlots =
    maxConcurrentImageJobs -
    jobs.filter((job) => job.status === "running" && job.mode === "image")
      .length;
  let availableNonImageSlots =
    maxConcurrentNonImageJobs -
    jobs.filter((job) => job.status === "running" && job.mode !== "image")
      .length;

  const nextJobs: QueueJobLike[] = [];

  for (const job of jobs) {
    if (job.status !== "queued" || activeSet.has(job.id)) continue;

    if (job.mode === "image") {
      if (availableImageSlots <= 0) continue;
      nextJobs.push(job);
      availableImageSlots -= 1;
      continue;
    }

    if (availableNonImageSlots <= 0) continue;
    nextJobs.push(job);
    availableNonImageSlots -= 1;
  }

  return nextJobs;
};

export const mergeGeneratedImagesInDisplayOrder = (
  existing: GeneratedImage[],
  incoming: GeneratedImage[],
) =>
  [...existing, ...incoming].sort((left, right) => {
    const batchDateCompare = (
      left.batchCreatedAt ??
      left.createdAt ??
      ""
    ).localeCompare(right.batchCreatedAt ?? right.createdAt ?? "");
    if (batchDateCompare !== 0) return batchDateCompare;

    const batchOrderCompare =
      (left.batchOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.batchOrder ?? Number.MAX_SAFE_INTEGER);
    if (batchOrderCompare !== 0) return batchOrderCompare;

    const imageOrderCompare =
      (left.imageOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.imageOrder ?? Number.MAX_SAFE_INTEGER);
    if (imageOrderCompare !== 0) return imageOrderCompare;

    return left.id.localeCompare(right.id);
  });

export const normalizeNavyImageUrlPayload = (
  imageUrl?: string | string[] | null,
  maxItems = 5,
) => {
  if (Array.isArray(imageUrl)) {
    const urls = imageUrl
      .map((url) => (typeof url === "string" ? url.trim() : ""))
      .filter(Boolean)
      .slice(0, maxItems);
    return urls.length ? urls : undefined;
  }

  if (typeof imageUrl !== "string") return undefined;
  const trimmed = imageUrl.trim();
  return trimmed || undefined;
};

export const buildNavyImageGenerationPayload = ({
  model,
  prompt,
  size,
  numberOfImages,
  quality,
  style,
  imageUrl,
  negativePrompt,
  seed,
  seconds,
  sync,
  responseFormat,
  aspectRatio,
}: NavyImageGenerationInput) => {
  const preparedPrompt = prepareImagePromptForModel(
    model,
    prompt,
    negativePrompt,
  );
  const promptWithNegativeGuidance = preparedPrompt.negativePrompt
    ? appendPromptNote(
        preparedPrompt.prompt,
        `Avoid these visual issues: ${preparedPrompt.negativePrompt}.`,
      )
    : preparedPrompt.prompt;
  const shouldPreferAspectRatio =
    typeof aspectRatio === "string" &&
    aspectRatio.trim() !== "" &&
    aspectRatio !== "1:1";
  const isLikelyVideoModel = NAVY_VIDEO_MODEL_PATTERN.test(model);
  const normalizedImageUrl = normalizeNavyImageUrlPayload(imageUrl);
  const normalizedSize =
    typeof size === "string" ? size.trim().toLowerCase() : "";

  return {
    model,
    prompt: promptWithNegativeGuidance,
    ...(normalizedSize ? { size: normalizedSize } : {}),
    ...(typeof numberOfImages === "number" && numberOfImages > 0
      ? { n: numberOfImages }
      : {}),
    ...(quality || !isLikelyVideoModel ? { quality: quality ?? "medium" } : {}),
    ...(style ? { style } : {}),
    ...(normalizedImageUrl ? { image_url: normalizedImageUrl } : {}),
    ...(typeof seed === "number" ? { seed } : {}),
    ...(typeof seconds === "number" ? { seconds } : {}),
    ...(typeof sync === "boolean" ? { sync } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(!normalizedSize && shouldPreferAspectRatio
      ? { aspect_ratio: aspectRatio }
      : {}),
  };
};

export const isNavyGenerationPending = (status?: string | null) => {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return [
    "queued",
    "pending",
    "processing",
    "running",
    "submitted",
    "in_progress",
  ].includes(normalized);
};

export const buildChutesChatSystemPrompt = ({
  toolImageModel,
  imageModels,
}: {
  toolImageModel: string;
  imageModels: Pick<ModelOption, "id" | "label">[];
}) => {
  const modelList = imageModels.map((item) => item.id).join(", ");

  return `${CHUTES_IMAGE_GUIDE_PROMPT}

You are an image generation assistant.

Rules:
- If the user explicitly asks to generate, create, render, or make an image and the request is specific enough, call generate_image.
- If the request is missing essential details, ask one short clarification question instead of guessing.
- Use the default image model unless the user asks for a specific model.
- When calling generate_image, always include a prompt string.
- Do not include a model in generate_image arguments unless the user explicitly asks for that exact model.
- For FLUX-style models, avoid negative prompts and rewrite exclusions as positive visual instructions.
- After the tool returns, briefly confirm what was generated and keep the response concise.

Default image model: ${toolImageModel}.
Available image models: ${modelList}.`;
};
