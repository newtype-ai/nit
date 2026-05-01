// ---------------------------------------------------------------------------
// nit — bounded HTTP helpers
// ---------------------------------------------------------------------------

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

export interface FetchWithTimeoutOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  label?: string;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const label = options.label ?? 'HTTP request';
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readResponseText(
  res: Response,
  label: string,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<string> {
  const length = res.headers.get('content-length');
  const parsedLength = length ? Number.parseInt(length, 10) : NaN;
  if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }

  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readResponseJson<T>(
  res: Response,
  label: string,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<T> {
  const text = await readResponseText(res, label, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
