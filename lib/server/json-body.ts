export const MAX_API_JSON_REQUEST_BYTES = 72 * 1024 * 1024;

export class JsonBodyError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "JsonBodyError";
    this.status = status;
  }
}

type JsonBodySource = {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
};

const validateByteLimit = (maxBytes: number) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("JSON body limit is invalid.");
  }
};

const validateDeclaredLength = (
  source: JsonBodySource,
  maxBytes: number,
) => {
  const contentLength = source.headers.get("content-length");
  if (contentLength === null) return;
  if (!/^\d+$/.test(contentLength)) {
    throw new JsonBodyError("Invalid JSON payload length.", 400);
  }
  const parsedLength = Number(contentLength);
  if (!Number.isSafeInteger(parsedLength)) {
    throw new JsonBodyError("Invalid JSON payload length.", 400);
  }
  if (parsedLength > maxBytes) {
    throw new JsonBodyError("JSON payload is too large.", 413);
  }
};

const combineChunks = (chunks: Uint8Array[], totalBytes: number) => {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const readBoundedBytes = async (
  source: JsonBodySource,
  maxBytes: number,
) => {
  if (!source.body) return new Uint8Array();

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JsonBodyError("JSON payload is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return combineChunks(chunks, totalBytes);
};

const decodeJson = (bytes: Uint8Array) => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    throw new JsonBodyError("Invalid JSON payload.", 400);
  }
};

export const readJsonRequestObject = async <T extends object>(
  request: Request,
  maxBytes = MAX_API_JSON_REQUEST_BYTES,
): Promise<T> => {
  validateByteLimit(maxBytes);
  validateDeclaredLength(request, maxBytes);
  const value = decodeJson(await readBoundedBytes(request, maxBytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonBodyError("JSON payload must be an object.", 400);
  }
  return value as T;
};

export const jsonBodyErrorDetails = (error: unknown) =>
  error instanceof JsonBodyError
    ? { error: error.message, status: error.status }
    : { error: "Invalid JSON payload.", status: 400 as const };
