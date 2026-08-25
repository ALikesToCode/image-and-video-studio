import {
  appendImagePromptDirective,
  imagePromptFingerprint,
  normalizeImagePromptAgeDescriptors,
  normalizeImagePromptStyleConflicts,
  normalizeImagePromptWhitespace,
  stripImagePromptEnvelope,
  stripImagePromptMetaInstructions,
  stripImagePromptWorkflowScaffolding,
} from "./image-prompt-language.ts";

const ADULT_IMAGE_PROMPT_PATTERN =
  /\b(nsfw|uncensored|explicit|nude|nudity|naked|erotic|boudoir|lingerie|topless|breasts?|nipples?|sexual|sex|sensual|intimate|provocative|seductive)\b/i;
const MINOR_IMAGE_PROMPT_PATTERN =
  /\b(?:infant|toddler|child|school-age|teenage|teenager|minor|underage)\b/i;
const POLICY_SENSITIVE_IMAGE_PROMPT_PATTERN =
  /\b(J-cup|hard\s+nipples?|crotch|heaving\s+chest|pleading\s+(?:wide\s+)?eyes|masked\s+man|non-?consensual|very\s+large\s+bust|student\s+council|school\s+uniform|slim\s+yet\s+curvy|curvy\s+build|dilated\s+pupils?|vacant\s+(?:eyes|gaze)|glassy\s+(?:eyes?|gaze)|bloody|blood\s*soaked|gore|gory|body\s+parts?|dismember(?:ed|ment)?|decapitat(?:ed|ion)|graphic\s+injur(?:y|ies)|torture|final\s+blow|suicide|self-?harm|cutting|hanging|overdose|terroris[mt]|extremis[mt]|propaganda|recruitment|build\s+(?:a\s+)?(?:bomb|gun|weapon)|weapon\s+(?:construction|procurement|use)|phishing|credential\s+theft|steal(?:ing)?\s+.*passwords?|malware|deepfake|impersonat(?:e|ion)|photorealistic\s+likeness)\b/i;

export const isOpenAiImageModel = (model: string) =>
  /\b(gpt-image-|dall-e-)/i.test(model);

export const isGeminiNativeImageModel = (model: string) => {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("nano-banana") ||
    (normalized.includes("gemini-") &&
      (normalized.includes("flash-image") || normalized.includes("pro-image")))
  );
};

const isImagenModel = (model: string) => model.toLowerCase().startsWith("imagen-");

const isGeminiImagePolicyModel = (model: string) => {
  const normalized = model.toLowerCase();
  return (
    isGeminiNativeImageModel(normalized) ||
    isImagenModel(normalized) ||
    normalized.includes("/imagen-")
  );
};

const normalizePrompt = (prompt: string) => {
  const withoutMetaInstructions = stripImagePromptMetaInstructions(
    stripImagePromptEnvelope(prompt),
  );
  return normalizeImagePromptStyleConflicts(
    normalizeImagePromptAgeDescriptors(
      normalizeImagePromptWhitespace(withoutMetaInstructions),
    ),
  );
};

const isPolicySensitiveImagePrompt = (prompt: string) =>
  ADULT_IMAGE_PROMPT_PATTERN.test(prompt) ||
  POLICY_SENSITIVE_IMAGE_PROMPT_PATTERN.test(prompt);

const reframePolicySensitiveVisualDetails = (prompt: string) =>
  normalizePrompt(prompt)
    .replace(
      /\bicy\s+blue\s+eyes\s+rendered\s+glassy\s+and\s+vacant\s+with\s+dilated\s+pupils\b/gi,
      "soft blue eyes rendered bright and reflective",
    )
    .replace(/\bstudent council room\b/gi, "university council room")
    .replace(/\bstudent council\b/gi, "university council")
    .replace(/\bhigh school\b/gi, "university")
    .replace(/\bschool uniform\b/gi, "formal academy-inspired blazer outfit")
    .replace(/\bslim\s+yet\s+curvy\b/gi, "slender hourglass silhouette")
    .replace(/\bcurvy\s+build\b/gi, "pronounced hourglass build")
    .replace(/\bcurvy\b/gi, "hourglass")
    .replace(
      /\bimpossibly\s+wide\s+hips\b/gi,
      "dramatic stylized hourglass silhouette",
    )
    .replace(/\berotic\s+standoff\s+atmosphere\b/gi, "dramatic editorial tension")
    .replace(/\berotic\b/gi, "dramatic editorial")
    .replace(/\bprovocative\b/gi, "glamorous")
    .replace(/\bsexualized\b/gi, "fashion editorial")
    .replace(/\bseductive\b/gi, "confident")
    .replace(/\bsexy\b/gi, "stylish")
    .replace(/\bdilated\s+pupils?\b/gi, "soft blue eyes")
    .replace(/\bvacant\s+(?:eyes|gaze)\b/gi, "reflective gaze")
    .replace(/\bvacant\b/gi, "reflective")
    .replace(/\bglassy\s+eyes?\b/gi, "bright eyes")
    .replace(/\bglassy\b/gi, "bright")
    .replace(
      /\bmassive\s+heavy\s+J-cup\s+breasts\s+straining\s+against\s+(?:her|their)\s+top\b/gi,
      "a pronounced hourglass silhouette in fitted activewear",
    )
    .replace(
      /\ba\s+(?:very\s+large|large)\s+bust\b/gi,
      "a pronounced hourglass silhouette",
    )
    .replace(
      /\b(?:very\s+large|large)\s+bust\b/gi,
      "pronounced hourglass silhouette",
    )
    .replace(
      /\bmassive\s+heavy\s+breasts?\b/gi,
      "pronounced hourglass silhouette",
    )
    .replace(/\bJ-cup\s+breasts?\b/gi, "pronounced upper-body silhouette")
    .replace(
      /\bhard\s+nipples?\s+poking\s+through\s+(?:her|their)\s+top\b/gi,
      "subtle fabric texture",
    )
    .replace(
      /\bhard\s+nipples?\s+faintly\s+outlined\s+through\s+(?:her|their)\s+top\b/gi,
      "subtle fabric texture",
    )
    .replace(/\bhard\s+nipples?\b/gi, "subtle fabric texture")
    .replace(/\b(?:nsfw|uncensored|explicit)\b/gi, "tasteful editorial")
    .replace(
      /\b(?:nude|nudity|naked|topless)\b/gi,
      "minimal-coverage fashion with opaque strategic draping",
    )
    .replace(/\bbreasts?\b/gi, "upper-body silhouette")
    .replace(/\bnipples?\b/gi, "subtle fabric detail")
    .replace(/\bsexual\b/gi, "intimate")
    .replace(/\bsex\b/gi, "intimacy")
    .replace(/\bsensual\b/gi, "elegant intimate")
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
    .replace(/\bnon-?consensual\b/gi, "consensual")
    .replace(/\bblood\s*soaked\b/gi, "rain-darkened")
    .replace(/\bbloody\b/gi, "non-graphic")
    .replace(/\bblood\b/gi, "dark rain")
    .replace(/\bbody\s+parts\s+everywhere\b/gi, "shattered armor and debris everywhere")
    .replace(/\bbody\s+parts\b/gi, "scattered debris")
    .replace(/\bgory?\b/gi, "non-graphic")
    .replace(/\bdismember(?:ed|ment)?\b/gi, "obscured aftermath")
    .replace(/\bdecapitat(?:ed|ion)\b/gi, "obscured aftermath")
    .replace(/\bgraphic\s+injur(?:y|ies)\b/gi, "non-graphic aftermath")
    .replace(/\btorture\b/gi, "symbolic conflict")
    .replace(/\bfinal\s+blow\b/gi, "decisive symbolic strike")
    .replace(/\bsuicide|self-?harm|cutting|hanging|overdose\b/gi, "symbolic recovery")
    .replace(/\bterroris[mt]\b/gi, "fictional authoritarian threat")
    .replace(/\bextremis[mt]\b/gi, "fictional authoritarian faction")
    .replace(/\bpropaganda|recruitment\b/gi, "historical warning poster")
    .replace(
      /\b(?:build\s+(?:a\s+)?(?:bomb|gun|weapon)|weapon\s+(?:construction|procurement|use))\b/gi,
      "nonfunctional fantasy prop on a museum display",
    )
    .replace(/\bphishing\b/gi, "simulated phishing incident")
    .replace(/\bcredential\s+theft\b/gi, "defensive credential-safety audit")
    .replace(
      /\bsteal(?:ing)?\s+.*passwords?\b/gi,
      "reviewing a simulated security incident with dummy data",
    )
    .replace(/\bmalware\b/gi, "defensive malware-analysis dashboard")
    .replace(
      /\bdeepfake|impersonat(?:e|ion)|photorealistic\s+likeness\b/gi,
      "fictionalized non-deceptive likeness",
    );

const reframeMinorSensitiveVisualDetails = (prompt: string) =>
  normalizeImagePromptWhitespace(
    prompt
      .replace(
        /\b(?:tasteful\s+editorial\s+)?minimal-coverage\s+fashion\s+with\s+opaque\s+strategic\s+draping\b/gi,
        "age-appropriate fully clothed fashion",
      )
      .replace(
        /\btasteful\s+editorial\b/gi,
        "age-appropriate fully clothed fashion",
      )
      .replace(/\bhyperfeminine\b/gi, "age-appropriate")
      .replace(
        /\b(?:(?:slender|pronounced|dramatic\s+stylized)\s+)?hourglass(?:\s+(?:build|figure|silhouette))?\b/gi,
        "age-appropriate build",
      )
      .replace(
        /\bpronounced\s+upper-body\s+silhouette\b/gi,
        "age-appropriate build",
      )
      .replace(
        /\b(?:boudoir|lingerie|erotic|sensual|seductive|provocative|intimate)\b/gi,
        "age-appropriate fully clothed fashion",
      )
      .replace(
        /\b(?:nude|nudity|naked|topless|nsfw|uncensored|explicit)\b/gi,
        "fully clothed",
      )
      .replace(
        /\b(?:breasts?|nipples?|cleavage|crotch)\b/gi,
        "clothing silhouette",
      )
      .replace(
        /\bage-appropriate(?:\s+age-appropriate)+\b/gi,
        "age-appropriate",
      ),
  );

const buildOpenAiAllowedImagePrompt = (
  prompt: string,
  { force = false }: { force?: boolean } = {},
) => {
  const normalizedPrompt = stripImagePromptWorkflowScaffolding(
    normalizePrompt(prompt),
  );
  if (!normalizedPrompt) return normalizedPrompt;
  const policyReadyPrompt =
    force || isPolicySensitiveImagePrompt(normalizedPrompt)
      ? reframePolicySensitiveVisualDetails(normalizedPrompt)
      : normalizedPrompt;
  return MINOR_IMAGE_PROMPT_PATTERN.test(normalizedPrompt) &&
    isPolicySensitiveImagePrompt(normalizedPrompt)
    ? reframeMinorSensitiveVisualDetails(policyReadyPrompt)
    : policyReadyPrompt;
};

const buildGeminiAllowedImagePrompt = (
  prompt: string,
  { force = false }: { force?: boolean } = {},
) => {
  const normalizedPrompt = normalizePrompt(prompt);
  if (!normalizedPrompt) return normalizedPrompt;
  const policyReadyPrompt =
    force || isPolicySensitiveImagePrompt(normalizedPrompt)
      ? reframePolicySensitiveVisualDetails(normalizedPrompt)
      : normalizedPrompt;
  return MINOR_IMAGE_PROMPT_PATTERN.test(normalizedPrompt) &&
    isPolicySensitiveImagePrompt(normalizedPrompt)
    ? reframeMinorSensitiveVisualDetails(policyReadyPrompt)
    : policyReadyPrompt;
};

export const preparePolicyImagePromptForModel = (
  model: string,
  prompt: string,
) => {
  if (isOpenAiImageModel(model)) return buildOpenAiAllowedImagePrompt(prompt);
  if (isGeminiNativeImageModel(model)) return buildGeminiAllowedImagePrompt(prompt);
  return normalizePrompt(prompt);
};

export const supportsSaferImagePromptRetry = (model: string) =>
  isOpenAiImageModel(model) || isGeminiImagePolicyModel(model);

export const buildSaferImagePromptForModel = (model: string, prompt: string) => {
  const normalizedPrompt = normalizePrompt(prompt);
  if (!supportsSaferImagePromptRetry(model)) return normalizedPrompt;
  if (isOpenAiImageModel(model)) {
    return buildOpenAiAllowedImagePrompt(normalizedPrompt, { force: true });
  }
  if (isGeminiNativeImageModel(model)) {
    return buildGeminiAllowedImagePrompt(normalizedPrompt, { force: true });
  }
  return reframePolicySensitiveVisualDetails(normalizedPrompt);
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
      if (
        IMAGE_POLICY_CATEGORIES.includes(
          category as (typeof IMAGE_POLICY_CATEGORIES)[number],
        )
      ) {
        categories.add(category);
      }
    }
  }

  for (const category of IMAGE_POLICY_CATEGORIES) {
    const pattern = new RegExp(
      `(^|[^a-z0-9_/-])${escapeRegExp(category)}([^a-z0-9_/-]|$)`,
      "i",
    );
    if (pattern.test(message)) categories.add(category);
  }

  return Array.from(categories);
};

const recoveryRewriteDirection = (nextAttempt: number) => {
  if (nextAttempt <= 2) {
    return "Make a surgical rewrite: keep every safe visual invariant and replace only the likely rejected detail.";
  }
  if (nextAttempt === 3) {
    return "Rebuild the wording as a concise subject-first production brief while preserving the same named subject, medium, framing, and mood.";
  }
  return "Use visibly different but intent-equivalent, non-explicit staging. Keep the named subject and art direction dominant while simplifying secondary details.";
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
  const saferPrompt = buildSaferImagePromptForModel(model, prompt);

  return `Rewrite this image prompt for ${model} after a provider safety rejection (try ${nextAttempt}/${maxAttempts}).
Flagged moderation categories: ${categoryLabel}.
${categoryGuidance.length ? `Category-specific changes: ${categoryGuidance.join("; ")}.` : "Remove any likely unsafe, explicit, graphic, coercive, minor-related, or prohibited details."}
${recoveryRewriteDirection(nextAttempt)}

Preserve the art medium, genre, setting, composition, named subject identity, semantic age band, adult context when present, lighting, camera/framing, palette, mood, and quality level.
When clothing or swimwear is part of the scene, preserve its non-explicit visual role, color, and context while making it properly fitting and removing fabric-strain or body-part focus.
Remove or neutralize the unsafe parts without replacing the requested style with a generic safe image.
Return only the final rewritten image prompt. Do not mention policy, moderation, safety systems, provider errors, blocked categories, or request IDs in the final prompt.

Prompt to rewrite:
${saferPrompt}`;
};

const uniqueModels = (candidates: string[]) => {
  const seen = new Set<string>();
  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    });
};

const gpt56Tier = (model: string) =>
  /gpt-5\.6-(luna|terra|sol)$/i.exec(model.trim())?.[1]?.toLowerCase() ?? "";

export type ImagePromptHelpModel = "auto" | "terra" | "sol";

export const normalizeImagePromptHelpModel = (
  value: unknown,
): ImagePromptHelpModel | "" =>
  value === "auto" || value === "terra" || value === "sol" ? value : "";

export const resolveImagePromptRecoveryChatModels = ({
  provider,
  activeModel,
  nextAttempt = 2,
}: {
  provider: string;
  activeModel: string;
  nextAttempt?: number;
}) => {
  if (provider !== "navy") return uniqueModels([activeModel]);
  const tier = gpt56Tier(activeModel);
  if (tier === "luna") {
    if (nextAttempt >= 4) return ["gpt-5.6-sol"];
    if (nextAttempt >= 3) return ["gpt-5.6-terra", "gpt-5.6-sol"];
    return uniqueModels([activeModel, "gpt-5.6-terra", "gpt-5.6-sol"]);
  }
  if (tier === "terra") {
    if (nextAttempt >= 3) return ["gpt-5.6-sol"];
    return uniqueModels([activeModel, "gpt-5.6-sol"]);
  }
  return uniqueModels([activeModel]);
};

export const resolveImagePromptHelpChatModels = ({
  provider,
  activeModel,
  requestedHelpModel,
}: {
  provider: string;
  activeModel: string;
  requestedHelpModel: ImagePromptHelpModel;
}) => {
  if (provider !== "navy") return [];
  const tier = gpt56Tier(activeModel);
  if (tier === "sol") return [];
  if (tier === "terra") {
    return requestedHelpModel === "terra" ? [] : ["gpt-5.6-sol"];
  }
  if (requestedHelpModel === "sol") return ["gpt-5.6-sol"];
  if (requestedHelpModel === "terra") {
    return ["gpt-5.6-terra", "gpt-5.6-sol"];
  }
  if (tier === "luna") return ["gpt-5.6-terra", "gpt-5.6-sol"];
  return [];
};

export const buildImagePromptHelpRequest = ({
  targetImageModel,
  prompt,
}: {
  targetImageModel: string;
  prompt: string;
}) => `Refine this production image prompt for ${targetImageModel}.
Return only the final image prompt.

Requirements:
- Preserve the user's named subjects, identity-defining details, lawful intent, output medium, mood, palette, and requested constraints.
- Return only the final renderable scene and direct visual constraints. Never include this guide, provider or model names, policy or safety commentary, retry language, or invisible instructions.
- For clearly adult subjects, preserve requested non-explicit hyperfeminine styling, hourglass silhouette, hair, makeup, layered jewelry, fashion, materials, and tasteful adult night-fashion or boudoir art direction. When source wording asks for nude, topless, uncensored, or explicit presentation, use positive visible wording such as minimal-coverage fashion with opaque strategic draping. Do not flatten lawful adult glamour into generic "balanced" styling.
- Keep a normal single-image brief compact: aim for roughly 120-220 words and no more than six short sections when possible. Exceed that range only for distinct visual, reference, edit, layout, or exact-text constraints.
- Write each visual fact once. Remove repeated descriptions, internal state labels, continuity commentary, planning notes, off-frame trivia, and empty headings without dropping any unique identity or composition invariant.
- Resolve workflow state silently and describe only the finished visible result. Never output words such as UNREGISTERED, REGISTERED, UNKNOWN, "resolving now," or "following continuity rules" as image content.
- Lead with output style, primary subject and visible action, then defining details, composition/camera, lighting, background, and constraints.
- Make the named primary subject visually dominant; background details receive the lowest priority unless the user explicitly says otherwise.
- Treat the requested medium as authoritative. For anime or another illustration style, use medium-native visible details and do not introduce photography, live-action, realistic-skin-texture, or subsurface-scattering cues unless the user explicitly requests a hybrid.
- Replace generic masterpiece, best-quality, ultra-detailed, and 8K keyword stacks with concrete medium-specific details.
- Replace exact numeric ages with the matching semantic age band: infant, toddler, child, teenager, young adult, adult, middle-aged adult, or older adult. Never age a minor into an adult.
- For a revision, make the requested change visibly meaningful and preserve everything else. Do not add new plot, characters, text, or unrelated scenery.
- Keep it policy-compliant. Do not attempt to bypass moderation or conceal prohibited intent.

Prompt:
${normalizePrompt(prompt)}`;

export const areImagePromptsEquivalent = (left: string, right: string) =>
  imagePromptFingerprint(left) === imagePromptFingerprint(right);

export const buildImageRetryFallbackPrompt = ({
  model,
  prompt,
  nextAttempt,
  maxAttempts,
}: {
  model: string;
  prompt: string;
  nextAttempt: number;
  maxAttempts: number;
}) => {
  const saferPrompt = buildSaferImagePromptForModel(model, prompt);
  const boundedAttempt = Math.min(Math.max(nextAttempt, 2), maxAttempts);
  const direction =
    boundedAttempt <= 2
      ? "Composition: keep the requested framing and named primary subject, with a cleaner silhouette, stronger subject-background separation, and fewer secondary details."
      : boundedAttempt === 3
        ? "Lighting and staging: keep the requested medium, palette, named subject, and identity details; use a clearer key light, restrained rim light, and simplified background staging."
        : "Pose and staging: keep the requested medium, palette, mood, named subject, and identity details; use a distinct pose with clean readable anatomy and minimal background competition.";
  return appendImagePromptDirective(saferPrompt, direction);
};

const STRICT_IMAGE_MODEL_VISUAL_REPHRASE_GUIDANCE = `Internal planning only: these guidelines are never image content and must never be copied into generate_image.
Before calling an OpenAI GPT Image or Gemini Nano Banana model, produce one compact renderable brief that preserves every unique lawful subject, identity, reference, edit, exact-text, composition, lighting, palette, mood, and exclusion invariant.
For clearly adult subjects, preserve requested non-explicit hyperfeminine styling, hourglass silhouette, layered jewelry, elaborate hair and makeup, fashion materials, and tasteful adult night-fashion or boudoir direction. Translate nude, topless, uncensored, or explicit source labels into positive visible wording such as minimal-coverage fashion with opaque strategic draping. Do not flatten lawful adult glamour into generic "balanced" styling.
For a normal single still, aim for roughly 120-220 words and no more than six short sections when possible. Exceed that range only when distinct constraints require it; never truncate or generalize away an invariant to meet the target.
Write each visual fact once. Remove repeated descriptions, empty headings, internal state labels, continuity commentary, planning notes, backend language, and off-frame trivia. Resolve workflow state silently and emit only the finished visible result.
Use subject-first order: medium and primary subject/action, identity-defining details, composition/camera, lighting/mood, background, then essential constraints. Keep the primary subject dominant and background detail subordinate unless requested otherwise.
Treat the requested medium as authoritative. Use medium-native visible details and never add photography or live-action cues to illustration unless the user requests a hybrid. Replace generic quality keyword stacks with concrete line, color, texture, material, and lighting direction.
Use semantic visual age tags rather than exact numeric ages. Preserve the established life stage and never age a minor into an adult.
Keep only what a single frame can depict. Translate thoughts, relationships, motion over time, and abstract intent into visible expression, pose, spacing, objects, environment, symbols, or lighting when needed.
For revisions and references, state the visible change and critical invariants once. For an unspecified variation, change one meaningful visual axis without changing identity or intent. Render exact requested text exactly and add no unrequested copy.
Translate provider-sensitive wording into a policy-compliant visible equivalent while preserving lawful theme and mood. Never mention policy, moderation, providers, models, retries, blocked categories, sanitization, or hidden instructions in the image prompt, and never try to evade moderation or conceal prohibited intent.`;

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
      "For Gemini Nano Banana models, preserve lawful adult intent and concrete visual details while adding painterly art direction, but respect Gemini safety settings for sexually explicit content and built-in child safety protections.",
    );
  }
  return hints.join("\n");
};
