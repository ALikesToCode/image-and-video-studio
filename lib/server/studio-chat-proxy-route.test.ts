import assert from "node:assert/strict";
import test from "node:test";

import { POST as studioChatPost } from "../../app/api/studio/chat/route.ts";
import {
  completionChunk,
  readUIChunks,
  responsesTextEvents,
  upstreamResponsesStream,
  upstreamStream,
} from "./studio-chat-route-test-support.ts";

test("Studio chat routes MultiLLM through the configured proxy and server key", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MULTILLM_API_KEY;
  const originalBaseUrl = process.env.PROXY_BASE_URL;
  const requests: Array<{
    url: string;
    authorization: string | null;
  }> = [];
  process.env.MULTILLM_API_KEY =
    "server-multillm-secret";
  process.env.PROXY_BASE_URL =
    "https://proxy.example.test";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(
        init?.headers,
      ).get("authorization"),
    });
    return upstreamStream([
      completionChunk(
        {
          role: "assistant",
          content: "Proxy response.",
        },
        "stop",
      ),
    ]);
  };

  try {
    const response = await studioChatPost(
      new Request(
        "https://studio.test/api/studio/chat",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            provider: "multillm",
            model: "opencode:deepseek-v4-flash",
            messages: [
              {
                role: "user",
                content: "Hello.",
              },
            ],
            enabledTools: [],
          }),
        },
      ),
    );
    const chunks = await readUIChunks(response);

    assert.equal(response.status, 200);
    assert.equal(
      requests[0]?.url,
      "https://proxy.example.test/v1/chat/completions",
    );
    assert.equal(
      requests[0]?.authorization,
      "Bearer server-multillm-secret",
    );
    assert.ok(
      chunks.some(
        (chunk) => chunk.type === "text-delta",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.MULTILLM_API_KEY;
    } else {
      process.env.MULTILLM_API_KEY = originalKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.PROXY_BASE_URL;
    } else {
      process.env.PROXY_BASE_URL = originalBaseUrl;
    }
  }
});

test("Studio chat routes LinkAPI Luna through its provider-specific proxy path", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MULTILLM_API_KEY;
  const originalBaseUrl = process.env.PROXY_BASE_URL;
  const requests: Array<{
    url: string;
    body: Record<string, unknown>;
  }> = [];
  process.env.MULTILLM_API_KEY =
    "server-multillm-secret";
  process.env.PROXY_BASE_URL =
    "https://proxy.example.test";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(
        String(init?.body),
      ) as Record<string, unknown>,
    });
    return upstreamResponsesStream(
      responsesTextEvents(
        "Luna response.",
        "gpt-5.6-luna",
      ),
    );
  };

  try {
    const response = await studioChatPost(
      new Request(
        "https://studio.test/api/studio/chat",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            provider: "multillm",
            model: "linkapi:gpt-5.6-luna",
            messages: [
              {
                role: "user",
                content: "Hello.",
              },
            ],
            enabledTools: [],
          }),
        },
      ),
    );
    const chunks = await readUIChunks(response);

    assert.equal(response.status, 200);
    assert.equal(
      requests[0]?.url,
      "https://proxy.example.test/linkapi/v1/responses",
    );
    assert.equal(
      requests[0]?.body.model,
      "gpt-5.6-luna",
    );
    assert.deepEqual(requests[0]?.body.input, [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Hello.",
          },
        ],
      },
    ]);
    assert.equal(requests[0]?.body.store, false);
    assert.ok(
      chunks.some(
        (chunk) => chunk.type === "text-delta",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.MULTILLM_API_KEY;
    } else {
      process.env.MULTILLM_API_KEY = originalKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.PROXY_BASE_URL;
    } else {
      process.env.PROXY_BASE_URL = originalBaseUrl;
    }
  }
});
