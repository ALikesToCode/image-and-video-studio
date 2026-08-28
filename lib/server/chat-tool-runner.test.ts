import test from "node:test";
import assert from "node:assert/strict";

import { runChatTools } from "../../app/components/chat/chutes-chat-tool-runner.ts";
import {
  MAX_CHAT_MODEL_STEPS,
  MAX_CHAT_TOOL_ROUNDS,
} from "../../app/components/chat/chutes-chat-types.ts";

const imageModel = { id: "image-model", label: "Image model" };

test("chat turns permit only one model tool round", () => {
  assert.equal(MAX_CHAT_TOOL_ROUNDS, 1);
  assert.equal(MAX_CHAT_MODEL_STEPS, 2);
});

test("chat tool runner blocks duplicate paid media calls", async () => {
  let imageCalls = 0;
  const messages = await runChatTools(
    {
      provider: "navy",
      toolSettings: { image: true, video: true, audio: true },
      imageModels: [imageModel],
      videoModels: [],
      audioModels: [],
      onGeneratedImage: () => undefined,
      saveToGallery: false,
      refreshMediaUsage: () => undefined,
      runImage: async (args) => {
        imageCalls += 1;
        return {
          images: [
            {
              id: `image-${imageCalls}`,
              dataUrl: "data:image/png;base64,AQID",
              mimeType: "image/png",
              model: "image-model",
            },
          ],
          model: "image-model",
          prompt: String(args.prompt),
          errors: [],
        };
      },
      runVideo: async () => {
        throw new Error("video must not run");
      },
      runAudio: async () => {
        throw new Error("audio must not run");
      },
    },
    [
      {
        id: "image-call-1",
        type: "function",
        function: {
          name: "generate_image",
          arguments: JSON.stringify({ prompt: "A lighthouse at dawn" }),
        },
      },
      {
        id: "image-call-2",
        type: "function",
        function: {
          name: "generate_image",
          arguments: JSON.stringify({ prompt: "A lighthouse at night" }),
        },
      },
    ]
  );

  assert.equal(imageCalls, 1);
  assert.equal(messages.length, 2);
  assert.match(messages[1]?.content ?? "", /Only one generate_image invocation/i);
  assert.equal(messages[1]?.toolCallId, "image-call-2");
});
