export type MediaResponsePolicy = {
  allowedContentTypes: readonly string[];
  maxBytes: number;
};

export type BoundedMediaBody = {
  bytes: Uint8Array;
  contentType: string;
};

const normalizeContentType = (value: string | null) =>
  (value ?? "").split(";", 1)[0].trim().toLowerCase();

const matchesAllowedContentType = (
  contentType: string,
  allowedContentTypes: readonly string[]
) =>
  allowedContentTypes.some((allowedValue) => {
    const allowed = normalizeContentType(allowedValue);
    return allowed.endsWith("/")
      ? contentType.startsWith(allowed)
      : contentType === allowed;
  });

const validateMaxBytes = (maxBytes: number) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Media response limit is invalid.");
  }
};

const validateMediaResponseHeaders = (
  response: Response,
  policy: MediaResponsePolicy
) => {
  validateMaxBytes(policy.maxBytes);

  const contentType = normalizeContentType(
    response.headers.get("content-type")
  );
  if (
    !contentType ||
    !matchesAllowedContentType(contentType, policy.allowedContentTypes)
  ) {
    throw new Error(
      `Unexpected media content type: ${contentType || "unknown"}.`
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Error("Media response length is invalid.");
    }
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("Media response length is invalid.");
    }
    if (parsedLength > policy.maxBytes) {
      throw new Error("Media response is too large.");
    }
  }

  return contentType;
};

const boundedBodyStream = (
  body: ReadableStream<Uint8Array>,
  maxBytes: number
) => {
  let receivedBytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          throw new Error("Media response is too large.");
        }
        controller.enqueue(chunk);
      },
    })
  );
};

export const readBoundedMediaBody = async (
  response: Response,
  policy: MediaResponsePolicy
): Promise<BoundedMediaBody> => {
  const contentType = validateMediaResponseHeaders(response, policy);
  if (!response.body) {
    return { bytes: new Uint8Array(), contentType };
  }

  const bytes = new Uint8Array(
    await new Response(
      boundedBodyStream(response.body, policy.maxBytes)
    ).arrayBuffer()
  );
  return { bytes, contentType };
};

export const proxyBoundedMediaResponse = (
  response: Response,
  policy: MediaResponsePolicy
) => {
  const contentType = validateMediaResponseHeaders(response, policy);
  const contentLength = response.headers.get("content-length");
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": contentType,
  });
  if (contentLength !== null) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(
    response.body
      ? boundedBodyStream(response.body, policy.maxBytes)
      : null,
    { status: 200, headers }
  );
};
