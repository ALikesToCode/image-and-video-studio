import {
  appendImagePromptDirective,
  imagePromptFingerprint,
  normalizeImagePromptAgeDescriptors,
  normalizeImagePromptWhitespace,
  stripImagePromptEnvelope,
} from "./image-prompt-language.ts";

const ADULT_IMAGE_PROMPT_PATTERN =
  /\b(nsfw|nude|nudity|naked|erotic|boudoir|lingerie|topless|breasts?|nipples?|sexual|sex|sensual|intimate|provocative|seductive)\b/i;
const POLICY_SENSITIVE_IMAGE_PROMPT_PATTERN =
  /\b(J-cup|hard\s+nipples?|crotch|heaving\s+chest|pleading\s+(?:wide\s+)?eyes|masked\s+man|non-?consensual|very\s+large\s+bust|student\s+council|school\s+uniform|slim\s+yet\s+curvy|curvy\s+build|dilated\s+pupils?|vacant\s+(?:eyes|gaze)|glassy\s+(?:eyes?|gaze)|bloody|blood\s*soaked|gore|gory|body\s+parts?|dismember(?:ed|ment)?|decapitat(?:ed|ion)|graphic\s+injur(?:y|ies)|torture|final\s+blow|suicide|self-?harm|cutting|hanging|overdose|terroris[mt]|extremis[mt]|propaganda|recruitment|build\s+(?:a\s+)?(?:bomb|gun|weapon)|weapon\s+(?:construction|procurement|use)|phishing|credential\s+theft|steal(?:ing)?\s+.*passwords?|malware|deepfake|impersonat(?:e|ion)|photorealistic\s+likeness)\b/i;

const OPENAI_IMAGE_ALLOWED_VISUAL_GOAL_NOTE =
  "Allowed visual goal: Preserve the theme through symbolism, fashion, environment, expression, lighting, texture, composition, color palette, and cinematic staging. Use safe visual language with no graphic injury, sexual exploitation, real-person impersonation, private data, instructions for wrongdoing, weapon-use detail, extremist praise or recruitment, self-harm depiction, or deceptive realism. Use clearly adult subjects, non-explicit styling, and consensual/non-threatening staging when people are relevant.";
const OPENAI_GPT_IMAGE_PRODUCTION_GUIDE_NOTE =
  "OpenAI GPT Image production prompt guide (instructions, not visible image text): Lead with the intended output format and the primary subject. Order the production brief as primary subject and action, defining details, composition/camera, lighting/mood, background/setting, then constraints. When a primary subject is named, make the primary subject visually dominant through scale, sharpness, contrast, placement, and detail; keep the background minimal and subordinate unless the user explicitly prioritizes it. Use semantic age tags such as infant, toddler, child, teenager, young adult, adult, middle-aged adult, or older adult instead of exact numeric ages. Be concrete about materials, shapes, textures, color, framing, viewpoint, placement, scale, pose, gaze, and object interactions. For photorealism, preserve natural lighting, real materials, texture, and believable camera framing. For edits or reference images, state the requested change and preserve identity, geometry, layout, brand elements, camera angle, saturation, contrast, and surrounding objects. Iterate with one clear change at a time and restate critical invariants. Render only text explicitly requested in quotes or ALL CAPS; keep it exact, legible, high contrast, and correctly placed. Do not invent extra words. Keep the final image polished and production-ready with no watermark, no signature, no unrelated logos, and no generic stock-photo treatment.";
const GEMINI_NANO_BANANA_PRODUCTION_GUIDE_NOTE =
  "Gemini Nano Banana production prompt guide (instructions, not visible image text): Write a concise narrative brief led by the output style, primary subject, and visible action, followed by defining details, composition and camera framing, lighting and color, then the background. When a primary subject is named, make the primary subject visually dominant through scale, sharpness, contrast, placement, and detail; keep the background minimal and subordinate unless the user explicitly prioritizes it. Use semantic age tags such as infant, toddler, child, teenager, young adult, adult, middle-aged adult, or older adult instead of exact numeric ages. For a requested revision, change only the requested visual detail, keep the remaining identity and composition invariants, and make the change visibly meaningful. Keep the prompt concrete, coherent, and free of redundant keyword lists, watermarks, signatures, unrelated logos, or unrequested text.";
const GEMINI_IMAGE_SAFETY_RECOVERY_NOTE =
  "Visual constraints: Preserve the lawful visual intent with tasteful non-explicit styling, age-appropriate portrayal, and consensual/non-threatening staging; replace graphic or exploitative detail with symbolic editorial art direction.";

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

const normalizePrompt = (prompt: string) =>
  normalizeImagePromptAgeDescriptors(
    normalizeImagePromptWhitespace(stripImagePromptEnvelope(prompt)),
  );

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
    .replace(/\bslim\s+yet\s+curvy\b/gi, "slim, balanced")
    .replace(/\bcurvy\s+build\b/gi, "balanced build")
    .replace(/\bcurvy\b/gi, "balanced")
    .replace(/\bimpossibly\s+wide\s+hips\b/gi, "balanced silhouette")
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
      "a balanced hourglass figure in fitted activewear",
    )
    .replace(
      /\ba\s+(?:very\s+large|large)\s+bust\b/gi,
      "a balanced hourglass figure",
    )
    .replace(
      /\b(?:very\s+large|large)\s+bust\b/gi,
      "balanced hourglass figure",
    )
    .replace(/\bmassive\s+heavy\s+breasts?\b/gi, "balanced hourglass figure")
    .replace(/\bJ-cup\s+breasts?\b/gi, "balanced upper-body silhouette")
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

const buildOpenAiAllowedImagePrompt = (
  prompt: string,
  { force = false }: { force?: boolean } = {},
) => {
  const normalizedPrompt = normalizePrompt(prompt);
  if (!normalizedPrompt) return normalizedPrompt;
  const policyReadyPrompt =
    force || isPolicySensitiveImagePrompt(normalizedPrompt)
      ? appendImagePromptDirective(
          reframePolicySensitiveVisualDetails(normalizedPrompt),
          OPENAI_IMAGE_ALLOWED_VISUAL_GOAL_NOTE,
        )
      : normalizedPrompt;
  return appendImagePromptDirective(
    policyReadyPrompt,
    OPENAI_GPT_IMAGE_PRODUCTION_GUIDE_NOTE,
  );
};

const buildGeminiAllowedImagePrompt = (
  prompt: string,
  { force = false }: { force?: boolean } = {},
) => {
  const normalizedPrompt = normalizePrompt(prompt);
  if (!normalizedPrompt) return normalizedPrompt;
  const policyReadyPrompt =
    force || isPolicySensitiveImagePrompt(normalizedPrompt)
      ? appendImagePromptDirective(
          reframePolicySensitiveVisualDetails(normalizedPrompt),
          GEMINI_IMAGE_SAFETY_RECOVERY_NOTE,
        )
      : normalizedPrompt;
  return appendImagePromptDirective(
    policyReadyPrompt,
    GEMINI_NANO_BANANA_PRODUCTION_GUIDE_NOTE,
  );
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
  return appendImagePromptDirective(
    reframePolicySensitiveVisualDetails(normalizedPrompt),
    GEMINI_IMAGE_SAFETY_RECOVERY_NOTE,
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
- Lead with output style, primary subject and visible action, then defining details, composition/camera, lighting, background, and constraints.
- Make the named primary subject visually dominant; background details receive the lowest priority unless the user explicitly says otherwise.
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
      ? "Variation direction: keep the named primary subject, medium, framing, lighting, and mood; replace only the rejected or unsupported detail with a non-explicit visual equivalent."
      : boundedAttempt === 3
        ? "Variation direction: rebuild this as a concise subject-first production brief. Keep the same named subject and identity details, make the requested change unmistakable, and reduce background detail."
        : "Variation direction: use a materially different but intent-equivalent composition, pose, or staging while preserving the named primary subject, medium, palette, mood, and constraints.";
  return appendImagePromptDirective(saferPrompt, direction);
};

const STRICT_IMAGE_MODEL_VISUAL_REPHRASE_GUIDANCE = `For OpenAI GPT Image and Gemini Nano Banana models, always rephrase the image prompt before calling generate_image. Preserve the user's lawful image intent while removing or softening disallowed, non-visual, or unsupported parts. Translate risky intent into a safe visual language instead of hiding it.
Follow a subject-first production order: intended output, primary subject and action, defining details, composition/camera, lighting/mood, background/setting, then constraints. When the user identifies a main character or primary focus, make that subject dominant through scale, sharpness, contrast, placement, and detail; give the background the lowest visual priority unless explicitly requested otherwise.
Use semantic visual age tags, never exact numeric ages or numeric age ranges: infant, toddler, child, teenager, young adult, adult, middle-aged adult, or older adult. Preserve the correct life stage and never age a minor into an adult.
For OpenAI GPT Image text-in-image requests, put exact visible copy in quotes or ALL CAPS, specify typography and placement, and add no extra words, captions, watermarks, signatures, or unrelated logos.
For OpenAI GPT Image edits or reference images, state what changes and what remains invariant, including identity, geometry, layout, brand elements, camera angle, lighting, saturation, contrast, and surrounding objects.
For a requested regeneration or variation, do not resubmit an identical prompt. Apply the user's requested change while restating critical invariants. If the user asks only for another version, vary one meaningful visual axis such as composition, pose, expression, lighting, or palette while preserving subject identity and intent.
Preserve the theme through symbolism, fashion, environment, expression, cinematic composition, lighting, texture, and color while removing operational or harmful detail.
Use tasteful artistic framing such as "tasteful artistic illustration", "vibrant intricate anime style", or "glamorous editorial artwork" when it fits the request.
For Nano Banana models, avoid repeated emphasis on explicit anatomy, body-hugging fabric, submission, eroticism, seductive framing, or explicit arching poses. Replace those details with non-explicit visible art direction such as "pronounced hourglass silhouette", "fitted outfit that follows the figure", "confident presentation", "glamorous poise", "warm amusement", "teasing smirk", "playful fondness", "intimate domestic mood", or "artistically charged atmosphere".
If another person appears in an intimate or tense scene, prefer a silhouetted, distant, or partially visible figure unless the user explicitly needs that person as a main subject. Avoid coercion, explicit sexual focus, or direct physical interaction as the center of the still image.
Keep only details that can be shown visually: subject, setting, composition, pose, clothing, objects, lighting, colors, style, mood, camera angle, background, symbols, readable text, and layout.
Ignore or convert anything that is not directly visual:
- Do not ask the image to speak, explain, argue, think, or teach.
- Do not include hidden meanings unless visible symbols, expressions, gestures, or scene design can show them.
- Do not follow audio, animation, interaction, or behavior-over-time instructions unless a single still frame can show them.
- Do not render long paragraphs of text inside the image.
- Do not include unnecessary labels, captions, names, or UI text unless explicitly requested.
- Treat names as context, not mandatory visible text, unless the user explicitly asks to render them.
- Render requested exact text exactly and keep it short, clear, and legible.
- If a concept is abstract, translate it into a strong visual metaphor.
Prioritize a clean, coherent, visually rich image. Remove clutter, backend notes, explanations, and anything the image model cannot depict. Do not try to bypass provider moderation; if the request cannot be safely rephrased, ask for a safer visual direction.`;

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
