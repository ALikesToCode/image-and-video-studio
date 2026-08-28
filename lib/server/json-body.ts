export const MAX_API_JSON_REQUEST_BYTES = 72 * 1024 * 1024;
export const MAX_API_JSON_RESPONSE_BYTES = 72 * 1024 * 1024;
export const MAX_UPSTREAM_ERROR_BYTES = 64 * 1024;

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

const parseJsonText = (text: string) => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    throw new JsonBodyError("Invalid JSON payload.", 400);
  }
};

export const readBoundedTextBody = async (
  source: JsonBodySource,
  maxBytes: number,
) => {
  validateByteLimit(maxBytes);
  validateDeclaredLength(source, maxBytes);
  const bytes = await readBoundedBytes(source, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new JsonBodyError("Invalid UTF-8 response body.", 400);
  }
};

export const readJsonResponse = async <T = unknown>(
  response: Response,
  maxBytes = MAX_API_JSON_RESPONSE_BYTES,
): Promise<T> =>
  parseJsonText(await readBoundedTextBody(response, maxBytes)) as T;

export const readJsonRequestObject = async <T extends object>(
  request: Request,
  maxBytes = MAX_API_JSON_REQUEST_BYTES,
): Promise<T> => {
  const value = parseJsonText(await readBoundedTextBody(request, maxBytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonBodyError("JSON payload must be an object.", 400);
  }
  return value as T;
};

export const jsonBodyErrorDetails = (error: unknown) =>
  error instanceof JsonBodyError
    ? { error: error.message, status: error.status }
    : { error: "Invalid JSON payload.", status: 400 as const };
