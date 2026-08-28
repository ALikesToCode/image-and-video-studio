import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonBodyError,
  jsonBodyErrorDetails,
  readJsonResponse,
  readJsonRequestObject,
} from "./json-body.ts";

test("bounded JSON reader accepts object payloads", async () => {
  const request = new Request("https://studio.test/api/example", {
    method: "POST",
    body: JSON.stringify({ prompt: "hello" }),
  });

  assert.deepEqual(await readJsonRequestObject(request, 64), {
    prompt: "hello",
  });
});

test("bounded JSON reader rejects oversized declared bodies before reading", async () => {
  const request = new Request("https://studio.test/api/example", {
    method: "POST",
    headers: { "content-length": "65" },
    body: "{}",
  });

  await assert.rejects(
    readJsonRequestObject(request, 64),
    (error: unknown) =>
      error instanceof JsonBodyError && error.status === 413,
  );
});

test("bounded JSON reader enforces streamed byte limits without content-length", async () => {
  const request = new Request("https://studio.test/api/example", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("too large"));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    readJsonRequestObject(request, 16),
    (error: unknown) =>
      error instanceof JsonBodyError && error.status === 413,
  );
});

test("bounded JSON reader rejects malformed lengths and non-object JSON", async () => {
  const invalidLength = new Request("https://studio.test/api/example", {
    method: "POST",
    headers: { "content-length": "1e3" },
    body: "{}",
  });
  const arrayPayload = new Request("https://studio.test/api/example", {
    method: "POST",
    body: "[]",
  });

  await assert.rejects(readJsonRequestObject(invalidLength, 64), JsonBodyError);
  await assert.rejects(readJsonRequestObject(arrayPayload, 64), JsonBodyError);
  assert.deepEqual(jsonBodyErrorDetails(new Error("private detail")), {
    error: "Invalid JSON payload.",
    status: 400,
  });
});

test("bounded JSON response reader rejects oversized provider bodies", async () => {
  const valid = Response.json({ status: "completed" });
  const oversized = new Response('{"status":"completed"}', {
    headers: { "content-length": "1024" },
  });

  assert.deepEqual(await readJsonResponse(valid, 64), {
    status: "completed",
  });
  await assert.rejects(
    readJsonResponse(oversized, 64),
    (error: unknown) =>
      error instanceof JsonBodyError && error.status === 413,
  );
});
