import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCancelledToolResults,
  createSyntheticFallbackToolCall,
  resolveChatTurnIntent,
  resolveChatTurnToolPolicy,
} from "./chat-turn-policy.ts";
import { buildAssistantToolContextContent } from "./chat-completion.ts";

const allMediaTools = {
  image: true,
  video: true,
  audio: true,
};

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
