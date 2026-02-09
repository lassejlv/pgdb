export class HttpError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiRequest<T>(opts: {
  baseUrl: string;
  token: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const url = new URL(opts.path, opts.baseUrl);

  for (const [key, value] of Object.entries(opts.query || {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json"
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal
    });

    const text = await response.text();
    const data = text.trim() ? tryParseJson(text) : undefined;

    if (!response.ok) {
      throw new HttpError(
        `Request failed (${response.status})`,
        response.status,
        data ?? text
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request to ${url.toString()} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
