import test from "node:test";
import assert from "node:assert/strict";

import {
  repairImageToolArguments,
  resolveToolArguments,
} from "./chat-tool-prompts.ts";

test("Image tool argument repair replaces negative-only prompt with assistant draft", () => {
  const assistantContent = `Let me craft this prompt carefully, preserving all the specific details the user provided.

A high-detail modern anime illustration of three figures in a tense triangular confrontation inside a slightly run-down shopping mall corridor during late afternoon. Center: a tall imposing young man with a lean densely muscular build and pale skin, wearing an intricate dark metal mask covering his entire face with etched sacred geometry and faintly glowing cyan circuitry patterns.

Optional negative prompt: blurry characters, extra limbs, deformed hands, watermark, text, logo, low detail, flat shading

Video readiness note: Stable triangular composition with clear character separation.`;

  const repaired = repairImageToolArguments(
    {
      prompt:
        "blurry characters, extra limbs, deformed hands, watermark, text, logo, low detail, flat shading",
    },
    {
      assistantContent,
      userPrompt: "Generate the mall confrontation image now.",
    }
  );

  assert.match(String(repaired.prompt), /high-detail modern anime illustration/i);
  assert.match(String(repaired.prompt), /shopping mall corridor/i);
  assert.equal(
    repaired.negative_prompt,
    "blurry characters, extra limbs, deformed hands, watermark, text, logo, low detail, flat shading"
  );
});

test("Image tool argument repair leaves valid image prompts intact", () => {
  const repaired = repairImageToolArguments(
    {
      prompt: "High-detail anime portrait in a neon arcade, cinematic rim light.",
      negative_prompt: "watermark, bad hands",
    },
    {
      assistantContent: "Optional negative prompt: watermark, bad hands",
      userPrompt: "Generate the image now.",
    }
  );

  assert.equal(
    repaired.prompt,
    "High-detail anime portrait in a neon arcade, cinematic rim light."
  );
  assert.equal(repaired.negative_prompt, "watermark, bad hands");
});

test("Malformed image tool arguments recover from assistant draft instead of erroring", () => {
  const resolved = resolveToolArguments({
    toolName: "generate_image",
    rawArgs: "{prompt:}",
    context: {
      assistantContent:
        "Final Flux prompt: cinematic anime rooftop duel, blue storm light, sharp silhouettes.",
      userPrompt: "Generate that image now.",
    },
  });

  assert.equal(resolved.recovered, true);
  assert.deepEqual(resolved.args, {
    prompt: "cinematic anime rooftop duel, blue storm light, sharp silhouettes.",
  });
});

test("Flux image tool repair prefers the assistant draft when tool args echo the raw request", () => {
  const userPrompt = `Create a high-detail modern anime illustration.

Background/setting: A sleek apartment lobby.
Main character (focus): Three figures at the entrance.`;
  const repaired = repairImageToolArguments(
    {
      prompt: userPrompt,
      model: "flux",
    },
    {
      assistantContent:
        "Final Flux prompt: modern anime lobby entrance scene, three sharply composed figures, cool marble reflections, warm doorway rim light.",
      userPrompt,
    },
    { preferAssistantPrompt: true }
  );

  assert.equal(
    repaired.prompt,
    "modern anime lobby entrance scene, three sharply composed figures, cool marble reflections, warm doorway rim light."
  );
});
