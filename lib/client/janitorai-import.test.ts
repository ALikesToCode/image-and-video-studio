import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeJanitorAiImageImport,
  readJanitorAiImageImport,
} from "./janitorai-import.ts";

const janitorLocation = (search: string, hash: string) => ({
  pathname: "/",
  search,
  hash,
});

test("JanitorAI import reads the prompt from the hash", () => {
  const request = readJanitorAiImageImport(
    janitorLocation(
      "?source=janitorai&mode=image&view=image&action=import",
      "#prompt=A%20quiet%20forest%20%26%20moon"
    )
  );

  assert.equal(request?.prompt, "A quiet forest & moon");
  assert.equal(request?.shouldAutoGenerate, false);
});

test("JanitorAI import selects the image tab and mode", () => {
  const request = readJanitorAiImageImport(
    janitorLocation(
      "?source=janitorai&mode=image&view=image&action=import",
      "#prompt=neon%20skyline"
    )
  );
  assert.ok(request);

  const calls: string[] = [];
  consumeJanitorAiImageImport(request, {
    selectImageTab: () => calls.push("selectImageTab"),
    setImageMode: () => calls.push("setImageMode"),
    setPrompt: (prompt) => calls.push(`setPrompt:${prompt}`),
    requestGeneration: (prompt) => calls.push(`requestGeneration:${prompt}`),
    replaceUrl: (url) => calls.push(`replaceUrl:${url}`),
  });

  assert.deepEqual(calls, [
    "selectImageTab",
    "setImageMode",
    "setPrompt:neon skyline",
    "replaceUrl:/?mode=image&view=image",
  ]);
});

test("JanitorAI autoGenerate queues generation once", () => {
  const request = readJanitorAiImageImport(
    janitorLocation(
      "?source=janitorai&mode=image&view=image&autoGenerate=1",
      "#prompt=glass%20temple"
    )
  );
  assert.ok(request);

  const generatedPrompts: string[] = [];
  consumeJanitorAiImageImport(request, {
    selectImageTab: () => {},
    setImageMode: () => {},
    setPrompt: () => {},
    requestGeneration: (prompt) => generatedPrompts.push(prompt),
    replaceUrl: () => {},
  });

  assert.deepEqual(generatedPrompts, ["glass temple"]);
});

test("JanitorAI autoGenerate keeps the imported prompt when the API key is missing", () => {
  const request = readJanitorAiImageImport(
    janitorLocation(
      "?source=janitorai&mode=image&view=image&action=generate",
      "#prompt=rain%20city"
    )
  );
  assert.ok(request);

  let prompt = "";
  let errorMessage = "";
  const apiKey = "";

  consumeJanitorAiImageImport(request, {
    selectImageTab: () => {},
    setImageMode: () => {},
    setPrompt: (nextPrompt) => {
      prompt = nextPrompt;
    },
    requestGeneration: () => {
      if (!apiKey) errorMessage = "API Key required";
    },
    replaceUrl: () => {},
  });

  assert.equal(prompt, "rain city");
  assert.equal(errorMessage, "API Key required");
});

test("JanitorAI import URL cleanup prevents generation on refresh", () => {
  const request = readJanitorAiImageImport(
    janitorLocation(
      "?source=janitorai&mode=image&view=image&action=generate&autoGenerate=1",
      "#prompt=single%20use"
    )
  );
  assert.ok(request);

  let replaceUrl = "";
  let generateCount = 0;
  consumeJanitorAiImageImport(request, {
    selectImageTab: () => {},
    setImageMode: () => {},
    setPrompt: () => {},
    requestGeneration: () => {
      generateCount += 1;
    },
    replaceUrl: (url) => {
      replaceUrl = url;
    },
  });

  const refreshedUrl = new URL(replaceUrl, "https://studio.local");
  const refreshedRequest = readJanitorAiImageImport({
    pathname: refreshedUrl.pathname,
    search: refreshedUrl.search,
    hash: refreshedUrl.hash,
  });

  assert.equal(generateCount, 1);
  assert.equal(replaceUrl, "/?mode=image&view=image");
  assert.equal(refreshedRequest, null);
});

test("JanitorAI image-agent chat handoff pre-fills the chat prompt", () => {
  const request = readJanitorAiImageImport(
    janitorLocation(
      "?view=image-agent&source=janitorai&mode=image-agent&action=chat",
      "#prompt=agent%20chat%20prompt"
    )
  );
  assert.ok(request);

  const calls: string[] = [];
  consumeJanitorAiImageImport(request, {
    selectImageTab: () => calls.push("selectImageTab"),
    setImageMode: () => calls.push("setImageMode"),
    setPrompt: (prompt) => calls.push(`setPrompt:${prompt}`),
    requestGeneration: (prompt) => calls.push(`requestGeneration:${prompt}`),
    selectImageAgentChat: () => calls.push("selectImageAgentChat"),
    setImageAgentChatPrompt: (prompt) =>
      calls.push(`setImageAgentChatPrompt:${prompt}`),
    replaceUrl: (url) => calls.push(`replaceUrl:${url}`),
  });

  assert.deepEqual(calls, [
    "selectImageAgentChat",
    "setImageAgentChatPrompt:agent chat prompt",
    "replaceUrl:/?view=image-agent&mode=image-agent",
  ]);
});
