import test from "node:test";
import assert from "node:assert/strict";

import {
  proxyBoundedMediaResponse,
  readBoundedMediaBody,
} from "./media-response.ts";

test("readBoundedMediaBody accepts an allowed bounded response", async () => {
  const result = await readBoundedMediaBody(
    new Response(Uint8Array.from([1, 2, 3]), {
      headers: {
        "content-length": "3",
        "content-type": "image/png; charset=binary",
      },
    }),
    { allowedContentTypes: ["image/png"], maxBytes: 3 }
  );

  assert.equal(result.contentType, "image/png");
  assert.deepEqual([...result.bytes], [1, 2, 3]);
});

test("readBoundedMediaBody rejects spoofed and missing content types", async () => {
  await assert.rejects(
    readBoundedMediaBody(
      new Response("not an image", {
        headers: { "content-type": "image/png-malformed" },
      }),
      { allowedContentTypes: ["image/png"], maxBytes: 100 }
    ),
    /content type/
  );
  await assert.rejects(
    readBoundedMediaBody(new Response("not an image"), {
      allowedContentTypes: ["image/"],
      maxBytes: 100,
    }),
    /content type/
  );
});

test("readBoundedMediaBody enforces declared and streamed size limits", async () => {
  await assert.rejects(
    readBoundedMediaBody(
      new Response(Uint8Array.from([1]), {
        headers: {
          "content-length": "1e2",
          "content-type": "audio/mpeg",
        },
      }),
      { allowedContentTypes: ["audio/"], maxBytes: 100 }
    ),
    /length is invalid/
  );
  await assert.rejects(
    readBoundedMediaBody(
      new Response(Uint8Array.from([1]), {
        headers: {
          "content-length": "101",
          "content-type": "audio/mpeg",
        },
      }),
      { allowedContentTypes: ["audio/"], maxBytes: 100 }
    ),
    /too large/
  );
  await assert.rejects(
    readBoundedMediaBody(
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        headers: { "content-type": "audio/mpeg" },
      }),
      { allowedContentTypes: ["audio/"], maxBytes: 3 }
    ),
    /too large/
  );
});

test("proxyBoundedMediaResponse preserves safe headers and limits its stream", async () => {
  const response = proxyBoundedMediaResponse(
    new Response(Uint8Array.from([1, 2, 3, 4]), {
      headers: { "content-type": "video/mp4" },
    }),
    { allowedContentTypes: ["video/"], maxBytes: 3 }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  await assert.rejects(response.arrayBuffer(), /too large/);
});
