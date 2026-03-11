/**
 * Raw HTTP helpers for calling tRPC endpoints without the client library.
 * The API uses no transformer, so plain JSON is sent/received.
 */

interface TrpcMutationOptions {
  apiUrl: string;
  path: string;
  input: Record<string, unknown>;
}

interface TrpcResult<T = unknown> {
  result: { data: T };
}

export async function trpcMutate<T = unknown>(opts: TrpcMutationOptions): Promise<T> {
  const url = `${opts.apiUrl.replace(/\/$/, "")}/trpc/${opts.path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as TrpcResult<T>;
  return json.result.data;
}

interface TrpcQueryOptions {
  apiUrl: string;
  path: string;
  input?: Record<string, unknown>;
}

export async function trpcQuery<T = unknown>(opts: TrpcQueryOptions): Promise<T> {
  const base = `${opts.apiUrl.replace(/\/$/, "")}/trpc/${opts.path}`;
  const url = opts.input ? `${base}?input=${encodeURIComponent(JSON.stringify(opts.input))}` : base;

  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as TrpcResult<T>;
  return json.result.data;
}
