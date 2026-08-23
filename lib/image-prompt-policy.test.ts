import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImagePolicyRecoveryPrompt,
  buildImageRetryFallbackPrompt,
  buildProviderPolicyHintForImageModels,
  buildSaferImagePromptForModel,
  extractImagePolicyViolationCategories,
  isLikelyImagePolicyError,
  prepareImageModelRequests,
  prepareImagePromptForModel,
  resolveImagePromptHelpChatModels,
  resolveImagePromptRecoveryChatModels,
} from "./studio-generation.ts";

test("OpenAI GPT image prompts reframe risky visual intent before the first request", () => {
  const prompt =
    "Mythic final strike in a dark-fantasy battlefield, bloody final blow with body parts everywhere, shockwave tearing through smoke and stone, black-purple energy.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt);
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt);

  assert.match(openAi.prompt, /Mythic final strike/i);
  assert.match(openAi.prompt, /shockwave tearing through smoke and stone/i);
  assert.match(openAi.prompt, /decisive symbolic strike/i);
  assert.match(openAi.prompt, /shattered armor and debris everywhere/i);
  assert.doesNotMatch(openAi.prompt, /bloody|body parts|gore|dismember/i);
  assert.match(gemini.prompt, /Mythic final strike/i);
  assert.match(gemini.prompt, /decisive symbolic strike/i);
  assert.doesNotMatch(gemini.prompt, /bloody|body parts|gore|dismember/i);
  assert.doesNotMatch(
    `${openAi.prompt}\n${gemini.prompt}`,
    /production prompt guide|allowed visual goal|policy|safety|instructions, not visible/i
  );
});

test("OpenAI adult-themed image prompts keep art direction without explicit body focus", () => {
  const prompt =
    "modern anime illustration, high detail, cinematic wide-to-medium shot. Tense erotic standoff atmosphere, shattered pride, desperate longing masked as rage, looming confrontation. Sharp focus, clean anatomy, clear silhouette, no text, no watermark.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt);
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt);

  assert.match(openAi.prompt, /modern anime illustration/i);
  assert.match(openAi.prompt, /cinematic wide-to-medium shot/i);
  assert.match(openAi.prompt, /dramatic editorial tension/i);
  assert.doesNotMatch(openAi.prompt, /erotic|sexual focus|Safety preflight|OpenAI GPT Image rewrite|Policy guardrails/i);
  assert.match(gemini.prompt, /modern anime illustration/i);
  assert.match(gemini.prompt, /dramatic editorial tension/i);
  assert.doesNotMatch(
    gemini.prompt,
    /erotic|production prompt guide|Visual constraints|Safety preflight|Gemini Nano Banana rewrite|Policy guardrails/i
  );
});

test("OpenAI GPT image prompts preserve clean user-authored visual briefs", () => {
  const prompt =
    "Create a photorealistic ceramic teapot on a walnut table beside morning window light.";
  const prepared = prepareImagePromptForModel(
    "gpt-image-2",
    prompt
  );

  assert.equal(prepared.prompt, prompt);
  assert.doesNotMatch(
    prepared.prompt,
    /production prompt guide|instructions, not visible|primary subject and action|Render only text/i
  );
  assert.equal(prepared.negativePrompt, undefined);
});

test("Flagged OpenAI and Gemini image models get model-scoped safer retry prompts", () => {
  const openAiPrompt = buildSaferImagePromptForModel(
    "gpt-image-1.5",
    "Create a provocative nightclub editorial portrait."
  );
  const geminiPrompt = buildSaferImagePromptForModel(
    "google/gemini-2.5-flash-image-preview",
    "Create a provocative nightclub editorial portrait."
  );
  const fluxPrompt = buildSaferImagePromptForModel(
    "flux",
    "Create a provocative nightclub editorial portrait."
  );

  assert.equal(openAiPrompt, "Create a glamorous nightclub editorial portrait.");
  assert.equal(geminiPrompt, "Create a glamorous nightclub editorial portrait.");
  assert.doesNotMatch(
    `${openAiPrompt}\n${geminiPrompt}`,
    /allowed visual goal|Visual constraints|policy|safety|instructions, not visible/i
  );
  assert.equal(fluxPrompt, "Create a provocative nightclub editorial portrait.");
  assert.equal(isLikelyImagePolicyError("blocked by image safety policy"), true);
});

test("Policy rejection recovery prompt preserves medium while targeting flagged categories", () => {
  const errorMessage =
    "Your request was rejected by the safety system. safety_violations=[sexual].";

  assert.deepEqual(extractImagePolicyViolationCategories(errorMessage), [
    "sexual",
  ]);

  const recoveryPrompt = buildImagePolicyRecoveryPrompt({
    model: "gpt-image-2",
    prompt: "Anime watercolor portrait of an adult nightclub singer in dramatic teal lighting.",
    errorMessage,
    nextAttempt: 2,
    maxAttempts: 4,
  });

  assert.match(recoveryPrompt, /try 2\/4/i);
  assert.match(recoveryPrompt, /sexual/i);
  assert.match(recoveryPrompt, /preserve.*art medium/i);
  assert.match(recoveryPrompt, /properly fitting/i);
  assert.match(recoveryPrompt, /watercolor portrait/i);
  assert.match(recoveryPrompt, /do not mention.*safety/i);
});

test("Prompt recovery uses the selected Navy chat model", () => {
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
    }),
    ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
    }),
    ["gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-sol",
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
      nextAttempt: 3,
    }),
    ["gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
      nextAttempt: 3,
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptRecoveryChatModels({
      provider: "chutes",
      activeModel: "Qwen/Qwen3-32B",
    }),
    ["Qwen/Qwen3-32B"]
  );
});

test("Explicit prompt help lets Luna ask Terra and Terra ask Sol", () => {
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
      requestedHelpModel: "auto",
    }),
    ["gpt-5.6-terra", "gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
      requestedHelpModel: "auto",
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-luna",
      requestedHelpModel: "sol",
    }),
    ["gpt-5.6-sol"]
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-terra",
      requestedHelpModel: "terra",
    }),
    []
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "navy",
      activeModel: "gpt-5.6-sol",
      requestedHelpModel: "terra",
    }),
    []
  );
  assert.deepEqual(
    resolveImagePromptHelpChatModels({
      provider: "chutes",
      activeModel: "Qwen/Qwen3-32B",
      requestedHelpModel: "auto",
    }),
    []
  );
});

test("Image prompts use semantic age bands without changing the requested life stage", () => {
  const prompt =
    "Premium anime close-up of Princess Leila, a beautiful 22-year-old woman, beside a 27-year-old man at dawn.";

  for (const model of [
    "gpt-image-2",
    "nano-banana-2",
    "navyai:gpt-image-2",
    "linkapi:nano-banana-2",
  ]) {
    const prepared = prepareImagePromptForModel(model, prompt).prompt;
    assert.match(prepared, /Princess Leila, a beautiful young adult woman/i);
    assert.match(prepared, /beside a young adult man/i);
    assert.doesNotMatch(prepared, /\b(?:22|27)(?:-year-old)?\b/i);
  }

  const teenagePrompt = prepareImagePromptForModel(
    "gpt-image-2",
    "A 16-year-old girl studying at a library desk."
  ).prompt;
  const teenageBrief = teenagePrompt.split("\n\n")[0] ?? "";
  assert.match(teenageBrief, /teenage girl/i);
  assert.doesNotMatch(teenageBrief, /young adult|adult woman/i);

  assert.equal(
    prepareImagePromptForModel(
      "plain-image-model",
      "A 35-year-old woman, a 55-year-old man, and a 70-year-old person."
    ).prompt,
    "An adult woman, a middle-aged man, and an older adult."
  );

  assert.equal(
    prepareImagePromptForModel(
      "plain-image-model",
      "A 100-year-old oak tree beside a cottage."
    ).prompt,
    "A 100-year-old oak tree beside a cottage."
  );
});

test("final image prompts contain renderable anime direction instead of LLM guidance", () => {
  const prompt = `Masterpiece modern anime illustration, best quality, ultra-detailed character rendering, 8K-level detail, of a 33-year-old woman.
Photorealistic fabric folds, detailed skin texture and subsurface scattering.

OpenAI GPT Image production prompt guide (instructions, not visible image text): For photorealism, preserve natural lighting and real materials.`;

  for (const model of ["gpt-image-2", "nano-banana-2"]) {
    const prepared = prepareImagePromptForModel(model, prompt).prompt;

    assert.match(prepared, /modern anime illustration/i);
    assert.match(prepared, /adult woman/i);
    assert.match(prepared, /intricate character rendering/i);
    assert.match(prepared, /fine linework and controlled color detail/i);
    assert.match(prepared, /illustrated fabric folds/i);
    assert.match(prepared, /cel-shaded skin gradients/i);
    assert.doesNotMatch(prepared, /33-year-old/i);
    assert.doesNotMatch(
      prepared,
      /production prompt guide|instructions, not visible|photoreal|realistic fabric|skin texture|subsurface scattering|masterpiece|best quality|ultra-detailed|8K/i
    );
  }
});

test("OpenAI and Nano Banana payloads preserve named subject priority without guidance", () => {
  const prompt =
    "Modern anime key art. Primary focus: Princess Leila facing the camera. Background: a softly lit stone room.";
  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;

  for (const prepared of [openAi, gemini]) {
    assert.equal(prepared, prompt);
    assert.match(prepared, /Primary focus: Princess Leila/i);
    assert.match(prepared, /Background: a softly lit stone room/i);
    assert.doesNotMatch(
      prepared,
      /production prompt guide|instructions, not visible|provider|model family/i
    );
  }
});

test("Deterministic image retries change the prompt while preserving its core intent", () => {
  const prompt =
    "Premium anime close-up of Princess Leila, a 22-year-old woman, in golden dawn light.";
  const second = buildImageRetryFallbackPrompt({
    model: "nano-banana-2",
    prompt,
    nextAttempt: 2,
    maxAttempts: 4,
  });
  const third = buildImageRetryFallbackPrompt({
    model: "nano-banana-2",
    prompt,
    nextAttempt: 3,
    maxAttempts: 4,
  });

  assert.notEqual(second, third);
  assert.match(second, /Princess Leila/i);
  assert.match(third, /Princess Leila/i);
  assert.match(second, /young adult woman/i);
  assert.doesNotMatch(second, /22-year-old/i);
  assert.match(second, /Composition:/i);
  assert.match(third, /Lighting and staging:/i);
  assert.doesNotMatch(
    `${second}\n${third}`,
    /variation direction|production prompt guide|retry|provider error/i
  );
});

test("Policy-sensitive OpenAI and Gemini prompts become safe visual goals before the first request", () => {
  const prompt = `Create a high-detail modern anime illustration.
Main character: a 29-year-old adult woman with massive heavy J-cup breasts straining against her top and impossibly wide hips.
Outfit: skin-tight pink sports crop top with a darkened patch at the crotch.
Pose: clutching a small gym bag to her heaving chest while looking up with pleading eyes at a masked man.
Lighting: shadows emphasize hard nipples faintly outlined through her top.`;

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;
  const flux = prepareImagePromptForModel("flux.2-pro", prompt).prompt;

  assert.match(openAi, /high-detail modern anime illustration/i);
  assert.match(openAi, /young adult woman/i);
  assert.match(openAi, /fitted activewear/i);
  assert.match(openAi, /holding a small gym bag close/i);
  assert.doesNotMatch(
    openAi,
    /J-cup|hard nipples|crotch|heaving chest|pleading eyes|masked man|allowed visual goal|production prompt guide|Safety preflight|Policy guardrails/i
  );
  assert.match(gemini, /young adult woman/i);
  assert.match(gemini, /fitted activewear/i);
  assert.match(gemini, /holding a small gym bag close/i);
  assert.doesNotMatch(
    gemini,
    /J-cup|hard nipples|crotch|heaving chest|pleading eyes|masked man|Visual constraints|production prompt guide|Safety preflight|Policy guardrails/i
  );
  assert.match(flux, /J-cup|hard nipples|crotch/i);
});

test("Selected image models apply provider-safe prompt shaping and only prepare Flux structurally", () => {
  const prompt =
    "Create a high-detail anime portrait of an adult woman with a very large bust, hard nipples faintly outlined through her top, and nervous tension in a tidy bedroom.";
  const requests = prepareImageModelRequests({
    models: ["gpt-image-2", "nano-banana-2", "flux.2-pro"],
    baseBody: { size: "1024x1024" },
    prompt,
  });
  const byModel = new Map(requests.map((request) => [request.model, request.prompt]));
  const gptPrompt = byModel.get("gpt-image-2") ?? "";
  const nanoPrompt = byModel.get("nano-banana-2") ?? "";
  const fluxPrompt = byModel.get("flux.2-pro") ?? "";

  assert.match(gptPrompt, /high-detail anime portrait/i);
  assert.match(gptPrompt, /balanced hourglass figure|balanced upper-body silhouette/i);
  assert.match(gptPrompt, /subtle fabric texture/i);
  assert.doesNotMatch(
    gptPrompt,
    /very large bust|hard nipples|non-explicit styling|production prompt guide/i
  );
  assert.match(nanoPrompt, /balanced hourglass figure/i);
  assert.match(nanoPrompt, /subtle fabric texture/i);
  assert.doesNotMatch(
    nanoPrompt,
    /very large bust|hard nipples|Gemini Nano Banana production prompt guide/i
  );
  assert.doesNotMatch(gptPrompt, /OpenAI GPT Image rewrite|Safety preflight|Policy guardrails/i);
  assert.doesNotMatch(nanoPrompt, /Gemini Nano Banana rewrite|Safety preflight|Policy guardrails/i);

  assert.match(fluxPrompt, /very large bust|hard nipples/i);
  assert.match(fluxPrompt, /Desired qualities/i);
});

test("GPT image prompts normalize age-ambiguous and school-coded wording before first request", () => {
  const requests = prepareImageModelRequests({
    models: ["gpt-image-2", "grok-imagine"],
    baseBody: {},
    prompt: `"Create a high-detail modern anime illustration.

Background/setting: A spacious student council room in late afternoon.
Main character (focus): Alya, apparent age 18, slim yet curvy build, porcelain-fair skin, icy blue eyes rendered glassy and vacant with dilated pupils."`,
  });
  const byModel = new Map(requests.map((request) => [request.model, request.body.prompt]));
  const gptPrompt = String(byModel.get("gpt-image-2") ?? "");
  const grokPrompt = String(byModel.get("grok-imagine") ?? "");
  const expected = `Create a high-detail modern anime illustration.
Background/setting: A spacious student council room in late afternoon.
Main character (focus): Alya, young adult, slim yet curvy build, porcelain-fair skin, icy blue eyes rendered glassy and vacant with dilated pupils.`;

  assert.match(gptPrompt, /spacious university council room/i);
  assert.match(gptPrompt, /young adult/i);
  assert.match(gptPrompt, /slim, balanced build/i);
  assert.match(gptPrompt, /bright and reflective/i);
  assert.match(gptPrompt, /soft blue eyes/i);
  assert.doesNotMatch(gptPrompt, /apparent age 18|student council|glassy|vacant|dilated|allowed visual goal|production prompt guide|Policy guardrails/i);
  assert.equal(grokPrompt, expected);
  assert.doesNotMatch(gptPrompt, /OpenAI GPT Image rewrite|Safety preflight|Policy guardrails/i);
});

test("Threat-framed OpenAI prompts keep tension without coercive staging", () => {
  const prompt =
    "Create an anime scene with a nervous adult woman looking up with pleading eyes at a masked man in a dark doorway.";

  const openAi = prepareImagePromptForModel("gpt-image-2", prompt).prompt;
  const gemini = prepareImagePromptForModel("nano-banana-2", prompt).prompt;

  assert.match(openAi, /anime scene/i);
  assert.match(openAi, /wide expressive eyes/i);
  assert.match(openAi, /mysterious figure/i);
  assert.doesNotMatch(openAi, /pleading eyes|masked man|consensual\/non-threatening staging|production prompt guide|Policy guardrails/i);
  assert.match(gemini, /wide expressive eyes/i);
  assert.match(gemini, /mysterious figure/i);
  assert.doesNotMatch(gemini, /pleading eyes|masked man|Visual constraints|production prompt guide/i);
  assert.doesNotMatch(openAi, /Safety preflight|rewrite|Policy guardrails/i);
  assert.doesNotMatch(gemini, /Safety preflight|rewrite|Policy guardrails/i);
});

test("Non-NSFW prompts remain unchanged for non-policy non-Flux models", () => {
  const prepared = prepareImagePromptForModel(
    "plain-image-model",
    "Create a ceramic teapot on a walnut table beside morning window light."
  );

  assert.equal(
    prepared.prompt,
    "Create a ceramic teapot on a walnut table beside morning window light."
  );
  assert.equal(prepared.negativePrompt, undefined);
});

test("Chat provider policy hint only appears when selected image models need it", () => {
  const hint = buildProviderPolicyHintForImageModels([
    "gpt-image-1.5",
    "gemini-3-pro-image-preview",
  ]);

  assert.match(hint, /OpenAI GPT Image/i);
  assert.match(hint, /Gemini Nano Banana/i);
  assert.match(hint, /always shape the final visual prompt before calling generate_image/i);
  assert.match(hint, /never text to copy into generate_image/i);
  assert.match(hint, /requested visual medium as a hard constraint/i);
  assert.match(hint, /never add photorealistic/i);
  assert.match(hint, /generic keyword stacks/i);
  assert.match(hint, /semantic visual age tags/i);
  assert.match(hint, /never exact numeric ages/i);
  assert.match(hint, /never age a minor into an adult/i);
  assert.match(hint, /primary subject and action/i);
  assert.match(hint, /background.*lowest visual priority/i);
  assert.match(hint, /do not resubmit an identical prompt/i);
  assert.match(hint, /tasteful artistic illustration/i);
  assert.match(hint, /pronounced hourglass silhouette/i);
  assert.match(hint, /silhouetted, distant, or partially visible figure/i);
  assert.match(hint, /Keep only details that can be shown visually/i);
  assert.match(hint, /Do not render long paragraphs of text inside the image/i);
  assert.match(hint, /translate it into a strong visual metaphor/i);
  assert.match(hint, /translate risky intent into a safe visual language/i);
  assert.match(hint, /Preserve the theme through symbolism/i);
  assert.match(hint, /Do not try to bypass provider moderation/i);
  assert.equal(hint.includes("exception to AI"), false);
  assert.equal(hint.includes("violent act"), false);
  assert.equal(hint.includes("explicit/visceral/graphic"), false);
  assert.equal(buildProviderPolicyHintForImageModels(["flux"]), "");
});


