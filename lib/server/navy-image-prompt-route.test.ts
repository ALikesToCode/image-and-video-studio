import test from "node:test";
import assert from "node:assert/strict";

import { POST as navyImagePost } from "../../app/api/navy/image/route.ts";

test("Navy image route retries flagged OpenAI image prompts with safer wording", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  const moderationValues: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    if (typeof requestBody.prompt === "string") {
      prompts.push(requestBody.prompt);
      moderationValues.push(requestBody.moderation);
    }
    if (prompts.length === 1) {
      return Response.json(
        { error: { message: "blocked by image safety policy" } },
        { status: 400 }
      );
    }
    return Response.json({ id: "job_safe", status: "queued" });
  };

  try {
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "gpt-image-1.5",
          prompt: "Create a provocative nightclub editorial portrait.",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { id: "job_safe", status: "queued" });
    assert.equal(prompts.length, 2);
    assert.deepEqual(moderationValues, ["low", "low"]);
    assert.match(
      prompts[0] ?? "",
      /Create a glamorous nightclub editorial portrait\./
    );
    assert.doesNotMatch(
      prompts[0] ?? "",
      /provocative|Allowed visual goal|production prompt guide|Safety recovery|policy-compliant OpenAI image prompt/i
    );
    assert.match(prompts[1] ?? "", /Composition:/i);
    assert.notEqual(prompts[1], prompts[0]);
    assert.doesNotMatch(
      prompts[1] ?? "",
      /provocative|Allowed visual goal|production prompt guide|Safety recovery|policy-compliant OpenAI image prompt/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route uses a prompt agent before strict-filter image models", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let imagePrompt = "";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (url === "https://api.navy/v1/chat/completions") {
      assert.equal(requestBody.model, "deepseek-v4-pro");
      assert.equal(requestBody.stream, false);
      assert.equal("temperature" in requestBody, false);
      const systemPrompt = Array.isArray(requestBody.messages)
        ? String(
            (
              requestBody.messages[0] as
                | { content?: unknown }
                | undefined
            )?.content ?? ""
          )
        : "";
      assert.equal(requestBody.max_tokens, 8192);
      assert.match(systemPrompt, /never copy it into the final image prompt/i);
      assert.match(systemPrompt, /requested visual medium as authoritative/i);
      assert.match(systemPrompt, /Return only the renderable scene and direct visual constraints/i);
      assert.match(systemPrompt, /Render exact in-image text only when explicitly requested/i);
      return Response.json({
        choices: [
          {
            message: {
              content: `Modern anime portrait of a 33-year-old woman in a tidy bedroom, realistic fabric folds, detailed skin texture and subsurface scattering.

OpenAI GPT Image production prompt guide (instructions, not visible image text): For photorealism, preserve real materials.`,
            },
          },
        ],
      });
    }

    if (url === "https://api.navy/v1/images/generations") {
      imagePrompt = String(requestBody.prompt ?? "");
      return Response.json({ id: "job_agent", status: "queued" });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          promptAgentModel: "deepseek-v4-pro",
          prompt:
            "Create an anime portrait with a very large bust and hard nipples faintly outlined.",
        }),
      })
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { id: "job_agent", status: "queued" });
    assert.deepEqual(calls, [
      "https://api.navy/v1/chat/completions",
      "https://api.navy/v1/images/generations",
    ]);
    assert.match(imagePrompt, /Modern anime portrait of an adult woman/i);
    assert.match(imagePrompt, /illustrated fabric folds/i);
    assert.match(imagePrompt, /cel-shaded skin gradients/i);
    assert.doesNotMatch(
      imagePrompt,
      /very large bust|hard nipples|33-year-old|production prompt guide|instructions, not visible|photoreal|realistic fabric|skin texture|subsurface scattering/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route sends OpenAI prompt agents through the Responses API", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let responseRequest: Record<string, unknown> = {};
  let generatedPrompt = "";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (url === "https://api.navy/v1/responses") {
      responseRequest = requestBody;
      return Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "A safe, detailed moonlit editorial portrait.",
              },
            ],
          },
        ],
      });
    }

    if (url === "https://api.navy/v1/images/generations") {
      generatedPrompt = String(requestBody.prompt ?? "");
      return Response.json({ id: "job_responses_agent", status: "queued" });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          promptAgentModel: "gpt-5",
          prompt: "Create a moonlit editorial portrait.",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://api.navy/v1/responses",
      "https://api.navy/v1/images/generations",
    ]);
    assert.equal(responseRequest.model, "gpt-5");
    assert.equal(responseRequest.stream, false);
    assert.equal(responseRequest.store, false);
    assert.equal(responseRequest.max_output_tokens, 8192);
    assert.equal("messages" in responseRequest, false);
    assert.ok(Array.isArray(responseRequest.input));
    assert.match(
      generatedPrompt,
      /^A safe, detailed moonlit editorial portrait\./
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route retries an output-limited prompt rewrite before generation", async () => {
  const originalFetch = globalThis.fetch;
  const rewriteBudgets: number[] = [];
  let generatedPrompt = "";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (url === "https://api.navy/v1/responses") {
      rewriteBudgets.push(Number(requestBody.max_output_tokens));
      if (rewriteBudgets.length === 1) {
        return Response.json({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output_text: "Partial prompt that must never reach image generation",
        });
      }
      return Response.json({
        status: "completed",
        output_text:
          "Complete modern anime scene with every requested character and setting detail preserved.",
      });
    }

    if (url === "https://api.navy/v1/images/generations") {
      generatedPrompt = String(requestBody.prompt ?? "");
      return Response.json({ id: "job_full_rewrite", status: "queued" });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          promptAgentModel: "gpt-5.6-luna",
          prompt: "A detailed modern anime character scene.",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(rewriteBudgets, [8_192, 32_768]);
    assert.match(generatedPrompt, /^Complete modern anime scene/i);
    assert.doesNotMatch(generatedPrompt, /Partial prompt/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Navy image route discards every partial rewrite and preserves the source prompt", async () => {
  const originalFetch = globalThis.fetch;
  const rewriteBudgets: number[] = [];
  let generatedPrompt = "";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (url === "https://api.navy/v1/responses") {
      rewriteBudgets.push(Number(requestBody.max_output_tokens));
      return Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: `Partial rewrite ${rewriteBudgets.length}`,
      });
    }

    if (url === "https://api.navy/v1/images/generations") {
      generatedPrompt = String(requestBody.prompt ?? "");
      return Response.json({ id: "job_source_prompt", status: "queued" });
    }

    return new Response(null, { status: 404 });
  };

  try {
    const sourcePrompt =
      "Modern anime illustration of an adult conductor on a moonlit train platform, with a red coat and brass lantern.";
    const response = await navyImagePost(
      new Request("https://studio.test/api/navy/image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-api-key": "navy-secret",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          promptAgentModel: "gpt-5.6-luna",
          prompt: sourcePrompt,
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(rewriteBudgets, [8_192, 32_768]);
    assert.match(generatedPrompt, /adult conductor on a moonlit train platform/i);
    assert.doesNotMatch(generatedPrompt, /Partial rewrite/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
