const IMAGE_SUBJECT_NOUN =
  "(?:adult\\s+)?(?:woman|man|person|girl|boy|female|male|lady|gentleman|character|subject)";
const IMAGE_PROMPT_META_BLOCK =
  /(?:^|\n)\s*(?:OpenAI GPT Image production prompt guide\b|Gemini Nano Banana production prompt guide\b|Allowed visual goal:\s*Preserve the theme through symbolism\b|Visual constraints:\s*Preserve the lawful visual intent\b|Variation direction:)[\s\S]*$/i;
const ANIME_STYLE_PATTERN =
  /\b(?:anime|manga|cel[-\s]?(?:shaded|shading)|anime key art|2D anime illustration)\b/i;
const EXPLICIT_ANIME_REALISM_HYBRID_PATTERN =
  /\b(?:(?:semi[-\s]?realistic|photorealistic|photo[-\s]?realistic|live[-\s]?action)\s+anime|anime[-\s]?inspired\s+(?:photo|photograph|photography))\b/i;

type SubjectKind = "female" | "male" | "neutral";

const subjectKind = (noun = ""): SubjectKind => {
  const normalized = noun.toLowerCase();
  if (/woman|girl|female|lady/.test(normalized)) return "female";
  if (/man|boy|male|gentleman/.test(normalized)) return "male";
  return "neutral";
};

const semanticAgeLabel = (age: number, noun = "") => {
  const kind = subjectKind(noun);
  if (age <= 1) {
    return kind === "female"
      ? "infant girl"
      : kind === "male"
        ? "infant boy"
        : "infant";
  }
  if (age <= 3) {
    return kind === "female"
      ? "toddler girl"
      : kind === "male"
        ? "toddler boy"
        : "toddler";
  }
  if (age <= 12) {
    return kind === "female"
      ? "school-age girl"
      : kind === "male"
        ? "school-age boy"
        : "child";
  }
  if (age <= 17) {
    return kind === "female"
      ? "teenage girl"
      : kind === "male"
        ? "teenage boy"
        : "teenager";
  }
  if (age <= 29) {
    return kind === "female"
      ? "young adult woman"
      : kind === "male"
        ? "young adult man"
        : "young adult";
  }
  if (age <= 49) {
    return kind === "female"
      ? "adult woman"
      : kind === "male"
        ? "adult man"
        : "adult";
  }
  if (age <= 64) {
    return kind === "female"
      ? "middle-aged woman"
      : kind === "male"
        ? "middle-aged man"
        : "middle-aged adult";
  }
  return kind === "female"
    ? "older woman"
    : kind === "male"
      ? "older man"
      : "older adult";
};

const decadeAge = (decade: string, phase: string) => {
  const normalized = decade.toLowerCase();
  const base = normalized.startsWith("teen")
    ? 15
    : Number.parseInt(normalized, 10);
  if (!Number.isFinite(base)) return null;
  if (normalized.startsWith("teen")) return base;
  const offset = phase.toLowerCase() === "early" ? 2 : phase.toLowerCase() === "late" ? 8 : 5;
  return base + offset;
};

export const normalizeImagePromptWhitespace = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

export const stripImagePromptEnvelope = (value: string) => {
  const trimmed = value.trim();
  let start = 0;
  let end = trimmed.length;

  while (start < end && (trimmed[start] === `"` || trimmed[start] === "'")) {
    start += 1;
  }
  while (
    end > start &&
    (trimmed[end - 1] === `"` || trimmed[end - 1] === "'")
  ) {
    end -= 1;
  }

  return trimmed.slice(start, end);
};

export const stripImagePromptMetaInstructions = (value: string) => {
  const match = IMAGE_PROMPT_META_BLOCK.exec(value);
  return (match ? value.slice(0, match.index) : value).trim();
};

const IMAGE_PROMPT_INTERNAL_LINE_PATTERN =
  /^\s*(?:internal\s+(?:state|note)|continuity\s+(?:state|note)|reasoning|serializer\s+(?:note|instruction)|prompt(?:-writing)?\s+(?:guide|guidance|instruction)|model\s+(?:note|instruction)|guidelines?)\s*:/i;
const IMAGE_PROMPT_INTERNAL_DIRECTIVE_PATTERN =
  /^(?:complete|resolve|state whether|serialize|track|never infer|do not serialize)\b.*\b(?:internally|silently|before writing|continuity|state|registration|serializer|field|rules?)\b/i;
const IMAGE_PROMPT_INTERNAL_STATE_PREFIX =
  /(^|:\s*)(?:UNREGISTERED|REGISTERED|UNKNOWN|ESTABLISHED|CHANGED)\b(?:\s*[\u2013\u2014-]\s*(?:resolving|preserving|tracking)(?:\s+now)?|\s*(?=[.;]|$))(?:[.;]\s*)?/g;
const IMAGE_PROMPT_RULE_REFERENCE =
  /\b(?:following|according to)\s+(?:the\s+)?(?:continuity|ear[-\s]styling|jewelry[-\s]diversity|image[-\s]prompt|serializer)(?:\s+(?:and|or)\s+[a-z -]+)?\s+rules?\b[.;,]?\s*/gi;

export const stripImagePromptWorkflowScaffolding = (value: string) => {
  const seenDetails = new Set<string>();
  const visualLines: string[] = [];

  for (const sourceLine of value.split("\n")) {
    if (IMAGE_PROMPT_INTERNAL_LINE_PATTERN.test(sourceLine)) continue;

    const line = sourceLine
      .replace(IMAGE_PROMPT_INTERNAL_STATE_PREFIX, "$1")
      .replace(IMAGE_PROMPT_RULE_REFERENCE, "")
      .replace(
        /\bComplete any required first-view registration silently before writing this field,?\s*then serialize only the resulting physical design\.?/gi,
        "",
      )
      .replace(
        /\bNever infer absence from an earlier crop, occlusion, or omission\.?/gi,
        "",
      )
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    if (!line || IMAGE_PROMPT_INTERNAL_DIRECTIVE_PATTERN.test(line)) continue;
    if (/^[^:\n]{1,48}:\s*$/.test(line)) continue;

    const visibleDetail = line.replace(/^[^:\n]{1,48}:\s*/, "");
    const fingerprint = imagePromptFingerprint(visibleDetail);
    if (fingerprint.length >= 16 && seenDetails.has(fingerprint)) continue;
    if (fingerprint.length >= 16) seenDetails.add(fingerprint);
    visualLines.push(line);
  }

  return normalizeImagePromptWhitespace(visualLines.join("\n"));
};

const replacePositivePhotoCue = (value: string) =>
  value.replace(
    /\b(?:photorealistic|photo[-\s]?realistic|professional photography|real photograph|live[-\s]?action)\b/gi,
    (match, offset: number, source: string) => {
      const prefix = source.slice(Math.max(0, offset - 16), offset);
      return /\b(?:not|avoid|without)\s+$/i.test(prefix)
        ? match
        : "stylized 2D anime rendering";
    },
  );

export const normalizeImagePromptStyleConflicts = (value: string) => {
  if (
    !ANIME_STYLE_PATTERN.test(value) ||
    EXPLICIT_ANIME_REALISM_HYBRID_PATTERN.test(value)
  ) {
    return value;
  }

  const styleNativeDetails = value
    .replace(
      /\b(?:photo[-\s]?realistic|realistic) fabric folds?(?: and (?:translucency|draping))?\b/gi,
      "crisp illustrated fabric folds and translucent fabric effects",
    )
    .replace(
      /\b(?:highly\s+)?detailed skin texture(?: and subsurface scattering)?\b/gi,
      "clean cel-shaded skin gradients",
    )
    .replace(
      /\b(?:photo[-\s]?realistic|realistic|natural) skin texture\b/gi,
      "clean stylized skin shading",
    )
    .replace(/\bsubsurface scattering\b/gi, "soft cel-shaded skin gradients");

  const normalized = replacePositivePhotoCue(styleNativeDetails)
    .replace(/^\s*masterpiece\s+(?=(?:modern\s+)?anime\b)/i, "")
    .replace(/\bbest quality\s*,?\s*/gi, "")
    .replace(
      /\bultra[-\s]?detailed\s+([a-z-]+)\s+rendering\b/gi,
      "intricate $1 rendering",
    )
    .replace(/\bultra[-\s]?detailed\b/gi, "intricate")
    .replace(
      /\b8K[-\s]?level\s+detail\b/gi,
      "fine linework and controlled color detail",
    )
    .replace(/\b8K[-\s]?quality appearance\b/gi, "polished anime finish")
    .replace(/\b8K\s+(?=(?:professional|anime|illustration|key art)\b)/gi, "");

  return normalizeImagePromptWhitespace(normalized)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,+/g, ",")
    .replace(/^\s*[,.;:]\s*/, "")
    .trim();
};

export const appendImagePromptDirective = (prompt: string, note: string) => {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return note;
  if (normalizedPrompt.toLowerCase().includes(note.toLowerCase())) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt}\n\n${note}`;
};

export const normalizeImagePromptAgeDescriptors = (value: string) => {
  let normalized = value;

  normalized = normalized.replace(
    new RegExp(
      `\\b(\\d{1,3})\\s*(?:-\\s*)?years?[-\\s]*old\\s+(${IMAGE_SUBJECT_NOUN})\\b`,
      "gi",
    ),
    (_match, rawAge: string, noun: string) =>
      semanticAgeLabel(Number.parseInt(rawAge, 10), noun),
  );
  normalized = normalized.replace(
    /\b(\d{1,3})\s*(?:-\s*)?years?[-\s]*old\b(?=\s*(?:(?:with|wearing|who|whose)\b|[,.;:!?)]|$))/gi,
    (_match, rawAge: string) =>
      semanticAgeLabel(Number.parseInt(rawAge, 10)),
  );
  normalized = normalized.replace(
    new RegExp(
      `\\b(${IMAGE_SUBJECT_NOUN})\\s*,?\\s*(?:with\\s+an?\\s+)?(?:apparent\\s+)?age(?:d)?\\s+(\\d{1,3})\\b`,
      "gi",
    ),
    (_match, noun: string, rawAge: string) =>
      semanticAgeLabel(Number.parseInt(rawAge, 10), noun),
  );
  normalized = normalized.replace(
    new RegExp(
      `\\b(?:apparent\\s+)?age\\s+(\\d{1,3})\\s+(${IMAGE_SUBJECT_NOUN})\\b`,
      "gi",
    ),
    (_match, rawAge: string, noun: string) =>
      semanticAgeLabel(Number.parseInt(rawAge, 10), noun),
  );
  normalized = normalized.replace(
    /\b(?:apparent\s+)?age\s+(\d{1,3})\b/gi,
    (_match, rawAge: string) =>
      semanticAgeLabel(Number.parseInt(rawAge, 10)),
  );
  normalized = normalized.replace(
    new RegExp(
      `\\b(${IMAGE_SUBJECT_NOUN})\\s+in\\s+(?:her|his|their)\\s+(early|mid|late)[-\\s]*(teens|20s|30s|40s|50s|60s|70s|80s|90s)\\b`,
      "gi",
    ),
    (_match, noun: string, phase: string, decade: string) => {
      const age = decadeAge(decade, phase);
      return age === null ? noun : semanticAgeLabel(age, noun);
    },
  );
  normalized = normalized.replace(
    /\b(early|mid|late)[-\s]*(teens|20s|30s|40s|50s|60s|70s|80s|90s)\b/gi,
    (_match, phase: string, decade: string) => {
      const age = decadeAge(decade, phase);
      return age === null ? _match : semanticAgeLabel(age);
    },
  );

  return normalized
    .replace(/\b([Aa])\s+(adult|older|infant)\b/g, (_match, article, label) =>
      `${article === "A" ? "An" : "an"} ${label}`,
    )
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
};

export const imagePromptFingerprint = (value: string) =>
  normalizeImagePromptWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
