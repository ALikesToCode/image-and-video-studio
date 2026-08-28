import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNanoGptImageToolRequest,
  buildNanoGptVideoToolRequest,
  buildChatCompletionPayload,
  buildChatCompletionRecoveryPayloads,
  buildChatMediaPreview,
  buildCancelledToolResults,
  buildAssistantToolContextContent,
  collectUnsafeChatMediaAssets,
  createSyntheticFallbackToolCall,
  isDeepSeekV4Model,
  isChatVideoModelSupported,
  normalizeDeepSeekReasoningEffort,
  normalizeImageToolModelRequest,
  normalizeReasoningEffort,
  repairImageToolArguments,
  resolveToolArguments,
  resolveRequestedImageModels,
  resolveChatTurnIntent,
  resolveChatTurnToolPolicy,
  resolveNavyVideoStartResult,
  runImageModelFallbackSequence,
  runImageModelPipelineParallel,
  sanitizeChatAttachmentAssets,
  sanitizeChatImageAssets,
  sanitizeChatMediaAssets,
  shouldOmitToolChoiceForModel,
  stripReasoningContentFromChatPayload,
  stripHeavyMediaFromMessagesForStorage,
  toChatCompletionMessages,
} from "./chat-tooling.ts";

test("aborted tool batches receive one result for every unresolved call", () => {
  assert.deepEqual(
    buildCancelledToolResults(
      [
        { id: "image-1", function: { name: "generate_image" } },
        { id: "video-1", function: { name: "generate_video" } },
      ],
      ["image-1"]
    ),
    [
      {
        toolCallId: "video-1",
        name: "generate_video",
        content: "Tool error: Cancelled by the user.",
      },
    ]
  );
});

test("NanoGPT chat image requests honor discovered model capabilities", () => {
  assert.deepEqual(
    buildNanoGptImageToolRequest({
      model: {
        id: "catalog-image",
        label: "Catalog Image",
        provider: "nanogpt",
        supportedResolutions: ["1024x1024", "1536x1024"],
        maxOutputImages: 2,
        maxReferenceImages: 1,
        supports: { referenceImages: true, seed: true },
      },
      prompt: "A glass observatory above the clouds",
      args: {
        quality: "high",
        seed: 42,
        image_url: [
          "https://media.example/first.png",
          "https://media.example/second.png",
        ],
      },
    }),
    {
      model: "catalog-image",
      prompt: "A glass observatory above the clouds",
      resolution: "1024x1024",
      quality: "high",
      seed: 42,
      numberOfImages: 1,
      input_references: ["https://media.example/first.png"],
      modelCapabilities: {
        supportedResolutions: ["1024x1024", "1536x1024"],
        maxOutputImages: 2,
        fixedOutputImages: undefined,
        maxReferenceImages: 1,
        supportsReferenceImages: true,
      },
    }
  );
});

test("NanoGPT chat image requests select the largest supported resolution when maximum quality is enabled", () => {
  const request = buildNanoGptImageToolRequest({
    model: {
      id: "catalog-image",
      label: "Catalog Image",
      provider: "nanogpt",
      supportedResolutions: ["1024x1024", "2048x1152", "1536x1024"],
    },
    prompt: "An anime city at blue hour",
    args: {},
    preferMaximumImageQuality: true,
  });

  assert.equal(request.resolution, "2048x1152");
});

test("NanoGPT chat video requests use catalog parameter names and source capability", () => {
  assert.deepEqual(
    buildNanoGptVideoToolRequest({
      model: {
        id: "catalog-video",
        label: "Catalog Video",
        provider: "nanogpt",
        inputModalities: ["text", "image"],
        outputModalities: ["video"],
        supports: {
          video: true,
          imageToVideo: true,
          textToVideo: false,
          sourceImage: true,
        },
        dynamicParameters: {
          duration: { type: "number" },
          aspect_ratio: {
            type: "select",
            options: [
              { value: "16:9", label: "16:9" },
              { value: "9:16", label: "9:16" },
            ],
          },
          seed: { type: "number" },
        },
      },
      prompt: "A paper kite rising over the ocean",
      sourceImage: "data:image/png;base64,YWJj",
      args: { seconds: 6, size: "16:9", seed: 7 },
    }),
    {
      model: "catalog-video",
      prompt: "A paper kite rising over the ocean",
      parameters: { duration: 6, aspect_ratio: "16:9", seed: 7 },
      sourceImage: "data:image/png;base64,YWJj",
    }
  );
});

test("chat video catalog hides workflows that require video or audio inputs", () => {
  assert.equal(
    isChatVideoModelSupported({
      id: "text-image-video",
      label: "Text and image video",
      provider: "nanogpt",
      inputModalities: ["text", "image"],
      outputModalities: ["video"],
      supports: { video: true, textToVideo: true, imageToVideo: true },
    }),
    true
  );
  assert.equal(
    isChatVideoModelSupported({
      id: "video-upscaler",
      label: "Video upscaler",
      provider: "nanogpt",
      inputModalities: ["video"],
      outputModalities: ["video"],
      supports: { video: true },
    }),
    false
  );
  assert.equal(
    isChatVideoModelSupported({
      id: "lip-sync",
      label: "Lip sync",
      provider: "nanogpt",
      inputModalities: ["image", "audio"],
      outputModalities: ["video"],
      supports: { video: true, imageToVideo: true },
    }),
    false
  );
});

test("Navy chat video accepts immediate URLs and queued job ids", () => {
  assert.deepEqual(
    resolveNavyVideoStartResult({
      videoUrl: "https://media.example/video.mp4",
      status: "completed",
    }),
    {
      videoUrl: "https://media.example/video.mp4",
      jobId: "",
    }
  );
  assert.deepEqual(resolveNavyVideoStartResult({ id: "job_123" }), {
    videoUrl: "",
    jobId: "job_123",
  });
});

test("Chat media preview keeps generated image metadata for fullscreen viewer", () => {
  const preview = buildChatMediaPreview({
    item: {
      id: "image-1",
      kind: "image",
      dataUrl: "data:image/png;base64,abc123",
      mimeType: "image/png",
      model: "flux-schnell",
    },
    prompt: "Render a cinematic mountain lake.",
    provider: "NavyAI",
  });

  assert.deepEqual(preview, {
    imageUrl: "data:image/png;base64,abc123",
    prompt: "Render a cinematic mountain lake.",
    model: "flux-schnell",
    provider: "NavyAI",
    kind: "image",
    mimeType: "image/png",
  });
});

const allMediaTools = {
  image: true,
  video: true,
  audio: true,
};

test("Auto routes an unambiguous imperative image request only to image generation", () => {
  const request = `Create a high-detail modern anime image.

Background/setting: Snow-covered hilltop overlook at night, a weathered wooden bench near a metal railing, HentaVille city lights glittering in the valley below like ground-level stars, heavy snowfall blanketing the scene, bare winter trees flanking the clearing, faint silhouettes of three figures standing near the railing behind the main subjects.

Main character (focus): Kieran, 21 years old, tall slim supermodel build, light flawless skin, amber eyes locked on a handwritten note, long black hair loose and wind-blown with snowflakes caught throughout, standing in ankle-deep snow facing the camera's left.

Secondary character: Genevieve Laurent, approximately 21 years old, tall slender aristocratic build, pale porcelain skin, sharp grey almond eyes glistening, high cheekbones, angular jaw, standing opposite Kieran with her arm still extended from handing over the note.

Composition/camera: First-person POV from Blake's position a few feet behind and between the two women, medium wide shot capturing both Kieran and Genevieve facing each other with the bench between them, city lights filling the valley below the railing, Blake's forearm visible at the bottom edge steadying Kieran's elbow.`;

  const decision = resolveChatTurnIntent(request, allMediaTools);

  assert.deepEqual(decision, {
    intent: "generate_image",
    source: "auto",
    reason: "Detected a direct image creation request.",
  });
  assert.deepEqual(resolveChatTurnToolPolicy(decision), {
    activeTools: ["generate_image"],
    forcedToolCall: "generate_image",
    allowSyntheticFallback: true,
  });
});

test("Direct image routing uses the requested output instead of later subject words", () => {
  const requests = [
    "Create an image of a wooden table.",
    "Create a poster with a list of names.",
    "Create an image of a React robot.",
    "Create an image for my video.",
    "Generate cover art for this audio.",
  ];

  for (const request of requests) {
    assert.equal(
      resolveChatTurnIntent(request, allMediaTools).intent,
      "generate_image",
      request
    );
  }
});

test("Auto does not offer another media tool when direct image generation is unavailable", () => {
  const decision = resolveChatTurnIntent("Create a modern anime image.", {
    image: false,
    video: true,
    audio: true,
  });

  assert.deepEqual(decision, {
    intent: "chat",
    source: "auto",
    reason: "Image generation is unavailable with the current tool settings.",
  });
  assert.deepEqual(resolveChatTurnToolPolicy(decision), {
    activeTools: [],
    forcedToolCall: null,
    allowSyntheticFallback: false,
  });
});

test("Auto keeps ambiguous and non-generation media requests unforced", () => {
  const requests = [
    "Create a prompt for an image of a rain-soaked neon street.",
    "Generate an image prompt, but do not create the image.",
    "Make this image prompt more cinematic.",
    "Explain how to generate an image with Flux.",
    "Compare image generation models and make a table.",
    "Make a table comparing image generation models.",
    "Design an image generation API.",
    "Brainstorm three image ideas for a travel campaign.",
    "Do not generate an image; just improve the prompt.",
    "I am not asking you to create a picture.",
    "Can you generate images?",
    "Do you support video generation?",
    "What image models can create logos?",
    "Analyze this image now.",
    "Render this React component.",
    "Create a photo gallery component.",
    "Create a video from this image.",
    "Remove the background from this photo.",
    "Use this reference and make a watercolor version.",
    "Yes, do it.",
    "Make another one.",
  ];

  for (const request of requests) {
    assert.deepEqual(resolveChatTurnIntent(request, allMediaTools), {
      intent: "auto",
      source: "auto",
      reason: "The agent can choose available generation tools from the full conversation.",
    }, request);
  }
});

test("Manual chat intent overrides auto generation", () => {
  assert.deepEqual(
    resolveChatTurnIntent(
      "Generate an image of a glass greenhouse.",
      allMediaTools,
      "chat"
    ),
    {
      intent: "chat",
      source: "manual",
      reason: "Generation tools are disabled for this turn.",
    }
  );
});

test("Manual media intent is deterministic and checks availability", () => {
  for (const intent of ["generate_image", "generate_video", "generate_audio"] as const) {
    assert.equal(
      resolveChatTurnIntent("Improve this prompt only.", allMediaTools, intent).intent,
      intent
    );
  }
  assert.deepEqual(
    resolveChatTurnIntent(
      "Create a video of the scene.",
      { image: true, video: false, audio: true },
      "generate_video"
    ),
    {
      intent: "chat",
      source: "manual",
      reason: "Video generation is unavailable with the current tool settings.",
    }
  );
});

test("Ambiguous Auto remains optional while a manual media mode forces a tool call", () => {
  const autoDecision = resolveChatTurnIntent(
    "Brainstorm an image concept for a lighthouse.",
    allMediaTools
  );
  const chatDecision = resolveChatTurnIntent(
    "Generate an image of a lighthouse.",
    allMediaTools,
    "chat"
  );
  const imageDecision = resolveChatTurnIntent(
    "Improve this prompt.",
    allMediaTools,
    "generate_image"
  );

  assert.deepEqual(resolveChatTurnToolPolicy(autoDecision), {
    activeTools: null,
    forcedToolCall: null,
    allowSyntheticFallback: false,
  });
  assert.deepEqual(resolveChatTurnToolPolicy(chatDecision), {
    activeTools: [],
    forcedToolCall: null,
    allowSyntheticFallback: false,
  });
  assert.deepEqual(resolveChatTurnToolPolicy(imageDecision), {
    activeTools: ["generate_image"],
    forcedToolCall: "generate_image",
    allowSyntheticFallback: true,
  });
});

test("Synthetic fallback builds an image tool call from the drafted prompt without pinning the default model", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_image",
    provider: "navy",
    userPrompt: "Generate an anime portrait now.",
    assistantContent:
      "Final Flux prompt: sharp modern anime portrait, blue rim light, clean silhouette.\nNegative prompt: watermark",
    imageModel: "flux",
    imagePipelineEnabled: true,
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
  });

  assert.deepEqual(fallback, {
    name: "generate_image",
    arguments: {
      prompt: "sharp modern anime portrait, blue rim light, clean silhouette.",
    },
  });
});

test("Synthetic fallback can use Kimi reasoning-only prompt drafts", () => {
  const assistantContent = buildAssistantToolContextContent({
    content: "",
    thinking:
      'The model is preparing the image tool arguments.\n\nPrompt:\n"High-detail modern anime illustration, humid aquatic center locker room, cold fluorescent lighting, tense cinematic mood."\n\nI should call generate_image with this prompt.',
  });
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_image",
    provider: "navy",
    userPrompt: "Create the locker-room anime image now.",
    assistantContent,
    imageModel: "gpt-image-2",
    imagePipelineEnabled: true,
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
  });

  assert.deepEqual(fallback, {
    name: "generate_image",
    arguments: {
      prompt:
        "High-detail modern anime illustration, humid aquatic center locker room, cold fluorescent lighting, tense cinematic mood.",
    },
  });
});

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

test("DeepSeek-family chat payloads omit explicit tool_choice while keeping tools", () => {
  assert.equal(shouldOmitToolChoiceForModel("deepseek-v4-pro"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-v4-flash"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-reasoner"), true);
  assert.equal(shouldOmitToolChoiceForModel("deepseek-ai/DeepSeek-V3"), true);
  assert.equal(isDeepSeekV4Model("deepseek-v4-pro"), true);
  assert.equal(isDeepSeekV4Model("deepseek-v4-flash"), true);

  const payload = buildChatCompletionPayload({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "Generate an image now." }],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    toolChoice: "auto",
    maxTokens: 256,
    temperature: 0.7,
    omitToolChoiceForUnsupportedModels: true,
  });

  assert.equal("tool_choice" in payload, false);
  assert.equal(payload.tools instanceof Array, true);
  assert.equal(payload.max_tokens, 256);
  assert.deepEqual(payload.thinking, { type: "enabled" });
  assert.equal(payload.reasoning_effort, "high");
  assert.equal("temperature" in payload, false);
});

test("DeepSeek V4 payloads can disable thinking and keep sampling controls", () => {
  const payload = buildChatCompletionPayload({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "Reply briefly." }],
    maxTokens: 64,
    temperature: 0.7,
    thinking: { type: "disabled" },
    reasoningEffort: "max",
  });

  assert.deepEqual(payload.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in payload, false);
  assert.equal(payload.temperature, 0.7);
});

test("DeepSeek V4 payloads support max reasoning effort aliases", () => {
  assert.equal(normalizeDeepSeekReasoningEffort("high"), "high");
  assert.equal(normalizeDeepSeekReasoningEffort("low"), "high");
  assert.equal(normalizeDeepSeekReasoningEffort("medium"), "high");
  assert.equal(normalizeDeepSeekReasoningEffort("max"), "max");
  assert.equal(normalizeDeepSeekReasoningEffort("xhigh"), "max");

  const payload = buildChatCompletionPayload({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "Think carefully." }],
    reasoningEffort: "max",
  });

  assert.deepEqual(payload.thinking, { type: "enabled" });
  assert.equal(payload.reasoning_effort, "max");
});

test("General Navy reasoning payloads use the model default temperature", () => {
  assert.equal(normalizeReasoningEffort("none"), "none");
  assert.equal(normalizeReasoningEffort("minimal"), "minimal");
  assert.equal(normalizeReasoningEffort("low"), "low");
  assert.equal(normalizeReasoningEffort("medium"), "medium");
  assert.equal(normalizeReasoningEffort("high"), "high");
  assert.equal(normalizeReasoningEffort("xhigh"), "xhigh");
  assert.equal(normalizeReasoningEffort("max"), "xhigh");
  assert.equal(normalizeReasoningEffort("invalid"), "high");

  const payload = buildChatCompletionPayload({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "Think carefully." }],
    reasoningEffort: "xhigh",
    temperature: 0.7,
  });

  assert.equal("thinking" in payload, false);
  assert.equal(payload.reasoning_effort, "xhigh");
  assert.equal("temperature" in payload, false);
});

test("OpenAI reasoning model payloads use the default temperature without metadata", () => {
  const payload = buildChatCompletionPayload({
    model: "openai/gpt-5-mini",
    messages: [{ role: "user", content: "Reply briefly." }],
    temperature: 0.7,
  });

  assert.equal("temperature" in payload, false);
});

test("Chat recovery can drop unsupported reasoning controls", () => {
  const payload = buildChatCompletionPayload({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "Think carefully." }],
    reasoningEffort: "xhigh",
    temperature: 0.7,
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload);
  assert.equal(recoveries[0]?.label, "omit-reasoning-controls");
  assert.equal("reasoning_effort" in recoveries[0].payload, false);
  assert.equal("temperature" in recoveries[0].payload, false);
});

test("Chat recovery explicitly disables reasoning when tools require it", () => {
  const payload = buildChatCompletionPayload({
    model: "future-tool-reasoner",
    messages: [{ role: "user", content: "Generate an image." }],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    toolChoice: "auto",
    reasoningEffort: "high",
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: {
      error: {
        message:
          "Function tools with reasoning_effort are not supported for future-tool-reasoner in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
      },
    },
  });

  assert.equal(recoveries[0]?.label, "disable-reasoning-for-tools");
  assert.equal(recoveries[0]?.payload.reasoning_effort, "none");
  assert.equal("tools" in recoveries[0].payload, true);
  assert.equal(recoveries[0].payload.tool_choice, "auto");
  assert.equal(payload.reasoning_effort, "high");
});

test("Chat tool recovery disables active reasoning and strips historical reasoning", () => {
  const payload = buildChatCompletionPayload({
    model: "future-tool-reasoner",
    messages: [
      { role: "user", content: "Generate an image." },
      {
        role: "assistant",
        content: "",
        reasoning_content: "I should call the image tool.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    reasoningEffort: "high",
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: {
      error: {
        message:
          "reasoning_effort must be none when function tools are present.",
      },
    },
  });
  const retryMessages = recoveries[0]?.payload.messages as Array<
    Record<string, unknown>
  >;

  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0]?.label, "disable-reasoning-for-tools");
  assert.equal(recoveries[0]?.payload.reasoning_effort, "none");
  assert.equal("reasoning_content" in retryMessages[1], false);
});

test("Chat recovery does not disable reasoning for unrelated provider errors", () => {
  const payload = buildChatCompletionPayload({
    model: "future-tool-reasoner",
    messages: [{ role: "user", content: "Generate an image." }],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    reasoningEffort: "high",
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: { error: { message: "Unsupported tool schema." } },
  });

  assert.equal(
    recoveries.some(
      (recovery) => recovery.label === "disable-reasoning-for-tools"
    ),
    false
  );
});

test("Non-DeepSeek chat payloads preserve explicit tool_choice", () => {
  const payload = buildChatCompletionPayload({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Generate an image now." }],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    toolChoice: "auto",
    omitToolChoiceForUnsupportedModels: true,
  });

  assert.equal(payload.tool_choice, "auto");
  assert.equal("thinking" in payload, false);
  assert.equal("reasoning_effort" in payload, false);
});

test("Chat payloads omit tool_choice when no tools are present", () => {
  const payload = buildChatCompletionPayload({
    model: "glm-5.1-venice",
    messages: [{ role: "user", content: "Reply briefly." }],
    toolChoice: "none",
    omitToolChoiceForUnsupportedModels: true,
  });

  assert.equal("tools" in payload, false);
  assert.equal("tool_choice" in payload, false);
});

test("Chat recovery payloads strip reasoning before dropping tools", () => {
  const payload = {
    model: "glm-5.1-venice",
    stream: true,
    messages: [
      { role: "user", content: "Generate an image." },
      {
        role: "assistant",
        content: "",
        reasoning_content: "Need to call the image tool.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "generate_image", arguments: "{\"prompt\":\"sky\"}" },
          },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: { name: "generate_image", parameters: { type: "object" } },
      },
    ],
    tool_choice: "auto",
  };

  const stripped = stripReasoningContentFromChatPayload(payload);
  assert.ok(stripped);
  assert.equal(
    "reasoning_content" in
      ((stripped?.messages as Array<Record<string, unknown>>)[1] ?? {}),
    false
  );
  assert.equal("tools" in (stripped ?? {}), true);

  const recoveries = buildChatCompletionRecoveryPayloads(payload);
  assert.deepEqual(
    recoveries.map((recovery) => recovery.label),
    ["strip-reasoning", "omit-tool-choice", "text-only"]
  );
  assert.equal("tools" in recoveries[0].payload, true);
  assert.equal("tool_choice" in recoveries[1].payload, false);
  assert.equal("tools" in recoveries[2].payload, false);
});

test("Chat recovery payloads can omit unsupported sampling fields", () => {
  const payload = buildChatCompletionPayload({
    model: "custom-chat-model",
    messages: [{ role: "user", content: "Rewrite this prompt." }],
    maxTokens: 700,
    temperature: 0.2,
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload);
  const omitSampling = recoveries.find(
    (recovery) => recovery.label === "omit-sampling"
  );

  assert.ok(omitSampling);
  assert.equal("temperature" in omitSampling.payload, false);
  assert.equal(omitSampling.payload.max_tokens, 700);
});

test("Chat recovery lowers rejected large output budgets without dropping tools", () => {
  const payload = buildChatCompletionPayload({
    model: "aihubmix:gpt-5.5-free",
    messages: [{ role: "user", content: "Generate an image." }],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    toolChoice: "auto",
    maxTokens: 16_384,
  });

  const recoveries = buildChatCompletionRecoveryPayloads(payload, {
    providerError: { error: { message: "Bad Request" } },
  });

  assert.equal(recoveries[0]?.label, "limit-output-tokens");
  assert.equal(recoveries[0]?.payload.max_tokens, 8_192);
  assert.equal("tools" in recoveries[0].payload, true);
  assert.equal(recoveries[0].payload.tool_choice, "auto");
});

test("Navy chat messages pass assistant reasoning content back for thinking-mode tool turns", () => {
  const messages = toChatCompletionMessages(
    [
      {
        role: "assistant",
        content: "",
        thinking: "Need to call the image tool.",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "generate_image", arguments: "{\"prompt\":\"sky\"}" },
          },
        ],
      },
      {
        role: "tool",
        content: "Image generated.",
        toolCallId: "call_1",
        name: "generate_image",
      },
    ],
    { includeReasoningContent: true }
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: "",
      reasoning_content: "Need to call the image tool.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "generate_image", arguments: "{\"prompt\":\"sky\"}" },
        },
      ],
    },
    {
      role: "tool",
      content: "Image generated.",
      tool_call_id: "call_1",
      name: "generate_image",
    },
  ]);
});

test("Chat completion messages drop local tool progress placeholders", () => {
  const messages = toChatCompletionMessages(
    [
      {
        role: "assistant",
        content: "",
        thinking: "Need image generation.",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "generate_image",
              arguments: "{\"prompt\":\"sky\"}",
            },
          },
        ],
      },
      {
        role: "tool",
        content: "Invoking generate_image...",
        toolCallId: "call_1",
        name: "generate_image",
      },
      {
        role: "tool",
        content: "Generated 1 image(s) using flux.",
        toolCallId: "call_1",
        name: "generate_image",
      },
    ],
    { includeReasoningContent: true }
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: "",
      reasoning_content: "Need image generation.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "generate_image",
            arguments: "{\"prompt\":\"sky\"}",
          },
        },
      ],
    },
    {
      role: "tool",
      content: "Generated 1 image(s) using flux.",
      tool_call_id: "call_1",
      name: "generate_image",
    },
  ]);
});

test("Chat completion messages drop orphaned tool responses from older synthetic fallback runs", () => {
  const messages = toChatCompletionMessages(
    [
      {
        role: "assistant",
        content: "I drafted the image prompt.",
      },
      {
        role: "tool",
        content: "Generated 1 image(s) using flux.",
        toolCallId: "synthetic-call-1",
        name: "generate_image",
      },
      {
        role: "user",
        content: "Continue.",
      },
    ],
    { includeReasoningContent: true }
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: "I drafted the image prompt.",
    },
    {
      role: "user",
      content: "Continue.",
    },
  ]);
});

test("Navy chat messages pass assistant reasoning content back without a tool call", () => {
  assert.deepEqual(
    toChatCompletionMessages(
      [
        {
          role: "assistant",
          content: "Done.",
          thinking: "Hidden provider reasoning.",
        },
      ],
      { includeReasoningContent: true }
    ),
    [
      {
        role: "assistant",
        content: "Done.",
        reasoning_content: "Hidden provider reasoning.",
      },
    ]
  );
});

test("User chat attachments become OpenAI-compatible multimodal content parts", () => {
  const messages = toChatCompletionMessages([
    {
      role: "user",
      content: "Describe these inputs.",
      attachments: [
        {
          id: "att-image",
          kind: "image",
          name: "scene.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,abc",
        },
        {
          id: "att-pdf",
          kind: "pdf",
          name: "brief.pdf",
          mimeType: "application/pdf",
          text: "Extracted PDF text",
          pagesRead: 2,
          totalPages: 3,
          truncated: true,
        },
      ],
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe these inputs." },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc" },
        },
        {
          type: "text",
          text: 'Attached pdf "brief.pdf" (PDF, application/pdf, 2/3 pages, truncated)\n\nExtracted PDF text',
        },
      ],
    },
  ]);
});

test("Sanitized chat attachments reject missing payloads and preserve usable files", () => {
  assert.deepEqual(
    sanitizeChatAttachmentAssets([
      {
        id: "img-1",
        kind: "image",
        name: "image.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc",
        size: 42,
      },
      {
        id: "bad-img",
        kind: "image",
        name: "missing-data.png",
        mimeType: "image/png",
      },
      {
        id: "text-1",
        kind: "text",
        name: "notes.md",
        mimeType: "text/markdown",
        text: "Notes",
      },
    ]),
    [
      {
        id: "img-1",
        kind: "image",
        name: "image.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc",
        size: 42,
      },
      {
        id: "text-1",
        kind: "text",
        name: "notes.md",
        mimeType: "text/markdown",
        text: "Notes",
      },
    ]
  );
});

test("Chat messages omit assistant thinking unless reasoning content is requested", () => {
  assert.deepEqual(
    toChatCompletionMessages([
      {
        role: "assistant",
        content: "Done.",
        thinking: "Hidden provider reasoning.",
      },
    ]),
    [
      {
        role: "assistant",
        content: "Done.",
      },
    ]
  );
});

test("Requested default image model uses the ordered fallback pipeline", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "flux",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Missing image model requests use the ordered fallback pipeline", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Requested image models try the selected model before ordered fallback", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "gpt-image-1.5",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["flux", "gpt-image-1.5"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Unavailable requested image models fall back to the ordered pipeline", () => {
  assert.deepEqual(
    resolveRequestedImageModels({
      requestedModel: "missing-model",
      defaultModel: "flux",
      imagePipelineEnabled: true,
      imageModelOrder: ["gpt-image-1.5", "flux"],
      availableModels: ["flux", "gpt-image-1.5"],
    }),
    ["gpt-image-1.5", "flux"]
  );
});

test("Chat image model requests preserve the assistant-selected model", () => {
  assert.equal(
    normalizeImageToolModelRequest({
      requestedModel: "grok-imagine",
    }),
    "grok-imagine"
  );
  assert.equal(
    normalizeImageToolModelRequest({
      requestedModel: " flux ",
    }),
    "flux"
  );
  assert.equal(
    normalizeImageToolModelRequest({
      requestedModel: "",
    }),
    ""
  );
});

test("Image model fallback sequence stops after the first successful model", async () => {
  const calls: string[] = [];
  const updates: string[] = [];

  const result = await runImageModelFallbackSequence({
    models: ["gpt-image-2", "flux", "nano-banana-2"],
    runModel: async (model) => {
      calls.push(model);
      if (model === "gpt-image-2") {
        throw new Error("blocked by image safety policy");
      }
      return [`image:${model}`];
    },
    onUpdate: (update) => updates.push(`${update.model}:${update.status}`),
  });

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model, "flux");
  assert.deepEqual(result.value, ["image:flux"]);
  assert.deepEqual(result.errors.map((entry) => entry.model), ["gpt-image-2"]);
  assert.deepEqual(calls, ["gpt-image-2", "flux"]);
  assert.deepEqual(updates, [
    "gpt-image-2:running",
    "gpt-image-2:error",
    "flux:running",
    "flux:success",
  ]);
});

test("Image model fallback sequence returns all errors when every model fails", async () => {
  const result = await runImageModelFallbackSequence({
    models: ["gpt-image-2", "flux"],
    runModel: async (model) => {
      throw new Error(`${model} failed`);
    },
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.errors.map((entry) => entry.model), [
    "gpt-image-2",
    "flux",
  ]);
});

test("Image model parallel pipeline starts ordered models before waiting", async () => {
  let releaseFirstModel: () => void = () => {};
  const firstModelGate = new Promise<void>((resolve) => {
    releaseFirstModel = resolve;
  });
  const calls: string[] = [];

  const resultPromise = runImageModelPipelineParallel({
    models: ["gpt-image-2", "flux"],
    maxAttempts: 1,
    runModel: async (model) => {
      calls.push(model);
      if (model === "gpt-image-2") {
        await firstModelGate;
      }
      return [`image:${model}`];
    },
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["gpt-image-2", "flux"]);
  releaseFirstModel();

  const result = await resultPromise;
  assert.equal(result.status, "fulfilled");
  assert.deepEqual(
    result.values.map((entry) => entry.model),
    ["gpt-image-2", "flux"]
  );
  assert.deepEqual(
    result.values.flatMap((entry) => entry.value),
    ["image:gpt-image-2", "image:flux"]
  );
});

test("Image model parallel pipeline retries each failed model up to the configured tries", async () => {
  const calls: string[] = [];
  const attempts: Array<{ model: string; attempt: number; maxAttempts: number }> = [];

  const result = await runImageModelPipelineParallel({
    models: ["gpt-image-2", "flux"],
    maxAttempts: 4,
    runModel: async (model, state) => {
      attempts.push({ model, attempt: state.attempt, maxAttempts: state.maxAttempts });
      calls.push(model);
      const modelCalls = calls.filter((entry) => entry === model).length;
      if (model === "gpt-image-2" && modelCalls < 4) {
        throw new Error(`temporary failure ${modelCalls}`);
      }
      return [`image:${model}:${modelCalls}`];
    },
  });

  assert.equal(result.status, "fulfilled");
  assert.deepEqual(
    calls.filter((entry) => entry === "gpt-image-2"),
    ["gpt-image-2", "gpt-image-2", "gpt-image-2", "gpt-image-2"]
  );
  assert.deepEqual(
    calls.filter((entry) => entry === "flux"),
    ["flux"]
  );
  assert.deepEqual(
    result.values.map((entry) => entry.value),
    [["image:gpt-image-2:4"], ["image:flux:1"]]
  );
  assert.deepEqual(
    attempts.filter((entry) => entry.model === "gpt-image-2"),
    [
      { model: "gpt-image-2", attempt: 1, maxAttempts: 4 },
      { model: "gpt-image-2", attempt: 2, maxAttempts: 4 },
      { model: "gpt-image-2", attempt: 3, maxAttempts: 4 },
      { model: "gpt-image-2", attempt: 4, maxAttempts: 4 },
    ]
  );
});

test("Chat image assets preserve per-image model labels", () => {
  assert.deepEqual(
    sanitizeChatImageAssets([
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "gpt-image-1.5",
        provider: "nanogpt",
      },
    ]),
    [
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "gpt-image-1.5",
        provider: "nanogpt",
      },
    ]
  );
});

test("Chat media assets preserve per-image model labels", () => {
  assert.deepEqual(
    sanitizeChatMediaAssets([
      {
        id: "img-1",
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "flux",
      },
    ]),
    [
      {
        id: "img-1",
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "flux",
      },
    ]
  );
});

test("restored chat media rejects unsafe, stale, and mismatched URLs", () => {
  const safeVideo = {
    id: "safe-video",
    kind: "video",
    dataUrl: "https://media.example/video.mp4",
    mimeType: "video/mp4",
  };
  const unsafeMedia = [
    {
      id: "file-video",
      kind: "video",
      dataUrl: "file:///home/user/video.mp4",
      mimeType: "video/mp4",
    },
    {
      id: "script-audio",
      kind: "audio",
      dataUrl: "javascript:alert(1)",
      mimeType: "audio/mpeg",
    },
    {
      id: "stale-blob",
      kind: "image",
      dataUrl: "blob:https://studio.example/stale",
      mimeType: "image/png",
    },
    {
      id: "wrong-data-kind",
      kind: "video",
      dataUrl: "data:image/png;base64,YWJj",
      mimeType: "video/mp4",
    },
  ];

  assert.deepEqual(sanitizeChatMediaAssets([safeVideo, ...unsafeMedia]), [
    safeVideo,
  ]);
  assert.deepEqual(
    collectUnsafeChatMediaAssets([
      {
        id: "message-1",
        media: unsafeMedia,
      },
    ]),
    unsafeMedia.map((asset) => ({
      messageId: "message-1",
      field: "media",
      asset,
    }))
  );
});

test("restored chat images and attachments reject unsafe URLs", () => {
  const unsafeImage = {
    id: "unsafe-image",
    dataUrl: "file:///home/user/image.png",
    mimeType: "image/png",
  };
  const unsafeAttachment = {
    id: "unsafe-attachment",
    kind: "image",
    name: "image.png",
    dataUrl: "javascript:alert(1)",
    mimeType: "image/png",
  };

  assert.deepEqual(sanitizeChatImageAssets([unsafeImage]), []);
  assert.deepEqual(sanitizeChatAttachmentAssets([unsafeAttachment]), []);
});

test("Synthetic fallback builds a Navy video tool call with current defaults", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_video",
    provider: "navy",
    userPrompt: "Generate a short video now.",
    assistantContent: "",
    imageModel: "flux",
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
    videoAspect: "16:9",
    videoDuration: "8",
    videoImage: "data:image/png;base64,abc123",
  });

  assert.deepEqual(fallback, {
    name: "generate_video",
    arguments: {
      prompt: "Generate a short video now.",
      model: "veo-3.1",
      size: "16:9",
      seconds: 8,
      image_url: "data:image/png;base64,abc123",
    },
  });
});

test("Synthetic fallback refuses Chutes video generation without a source image", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_video",
    provider: "chutes",
    userPrompt: "Animate this now.",
    assistantContent: "",
    imageModel: "flux",
    videoModel: "ltx-video",
    audioModel: "kokoro",
  });

  assert.equal(fallback, null);
});

test("Synthetic fallback builds an audio tool call with current TTS defaults", () => {
  const fallback = createSyntheticFallbackToolCall({
    requestedTool: "generate_audio",
    provider: "navy",
    userPrompt: "Read this welcome message aloud now.",
    assistantContent: "Final script: Welcome to the studio.",
    imageModel: "flux",
    videoModel: "veo-3.1",
    audioModel: "gpt-4o-mini-tts",
    ttsVoice: "alloy",
    ttsFormat: "mp3",
    ttsSpeed: "1.1",
  });

  assert.deepEqual(fallback, {
    name: "generate_audio",
    arguments: {
      input: "Welcome to the studio.",
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      response_format: "mp3",
      speed: 1.1,
    },
  });
});

test("Persisted chat history drops heavy media payloads and keeps newest entries", () => {
  const stored = stripHeavyMediaFromMessagesForStorage(
    [
      {
        id: "old",
        role: "assistant",
        content: "Old",
        media: [{ id: "m-old", kind: "image", dataUrl: "data:image/png;base64,old" }],
      },
      {
        id: "new",
        role: "tool",
        content: "Generated image.",
        images: [{ id: "img-1", dataUrl: "data:image/png;base64,new" }],
        attachments: [
          {
            id: "att-1",
            kind: "image",
            name: "source.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,source",
          },
        ],
      },
    ],
    1
  );

  assert.deepEqual(stored, [
    {
      id: "new",
      role: "tool",
      content: "Generated image.",
    },
  ]);
});
