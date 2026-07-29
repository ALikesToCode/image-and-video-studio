import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenAIResponsesPayload,
  extractOpenAIResponseText,
  isOpenAIReasoningModel,
  isOpenAIResponsesModel,
  shouldUseOpenAIResponses,
} from "./openai-responses.ts";

test("recognizes routed OpenAI text models without capturing media models", () => {
  for (const model of [
    "gpt-4o",
    "gpt-5.5",
    "openai/gpt-5-mini",
    "o4-mini",
    "navyai:gpt-5",
    "linkapi:gpt-5.6-luna",
    "ft:gpt-4.1-mini:org:project:model",
  ]) {
    assert.equal(isOpenAIResponsesModel(model), true, model);
  }

  for (const model of [
    "glm-5.1-venice",
    "grok-4.3",
    "google/gemini-3-flash",
    "gpt-image-2",
    "gpt-4o-mini-tts",
  ]) {
    assert.equal(isOpenAIResponsesModel(model), false, model);
  }

  assert.equal(isOpenAIReasoningModel("openai/gpt-5-mini"), true);
  assert.equal(isOpenAIReasoningModel("gpt-4o"), false);
  assert.equal(shouldUseOpenAIResponses("navy", "gpt-5"), true);
  assert.equal(
    shouldUseOpenAIResponses("multillm", "linkapi:gpt-5.6-luna"),
    true
  );
  assert.equal(shouldUseOpenAIResponses("nanogpt", "gpt-5"), false);
});

test("maps chat messages, function tools, and reasoning to Responses", () => {
  assert.deepEqual(
    buildOpenAIResponsesPayload({
      model: "openai/gpt-5-mini",
      messages: [
        { role: "system", content: "Use tools when requested." },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this." },
            {
              type: "image_url",
              image_url: { url: "https://example.test/image.png", detail: "low" },
            },
          ],
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "generate_image",
                arguments: '{"prompt":"harbor"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "Generated 1 image.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "generate_image",
            description: "Generate an image.",
            parameters: {
              type: "object",
              properties: { prompt: { type: "string" } },
              required: ["prompt"],
            },
            strict: true,
          },
        },
      ],
      toolChoice: {
        type: "function",
        function: { name: "generate_image" },
      },
      maxTokens: 1200,
      temperature: 0.7,
      reasoningEffort: "high",
    }),
    {
      model: "openai/gpt-5-mini",
      input: [
        { role: "system", content: "Use tools when requested." },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Describe this." },
            {
              type: "input_image",
              image_url: "https://example.test/image.png",
              detail: "low",
            },
          ],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "generate_image",
          arguments: '{"prompt":"harbor"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "Generated 1 image.",
        },
      ],
      stream: true,
      store: false,
      tools: [
        {
          type: "function",
          name: "generate_image",
          description: "Generate an image.",
          parameters: {
            type: "object",
            properties: { prompt: { type: "string" } },
            required: ["prompt"],
          },
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: "generate_image" },
      max_output_tokens: 1200,
      reasoning: { effort: "high" },
    }
  );
});

test("extracts the convenience text from a completed response", () => {
  assert.equal(
    extractOpenAIResponseText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "A refined " },
            { type: "output_text", text: "prompt." },
          ],
        },
      ],
    }),
    "A refined prompt."
  );
});
