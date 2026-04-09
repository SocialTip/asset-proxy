import { Readable } from "node:stream";

import { Agent, H2CClient } from "undici";

export interface H2Response {
  status: number;
  ok: boolean;
  headers: Headers;
  body: Readable | null;
}

const h2Agent = new Agent({ allowH2: true });
const h2cClients = new Map<string, H2CClient>();

function getH2cDispatcher(url: URL): H2CClient {
  const origin = url.origin;
  let client = h2cClients.get(origin);
  if (!client || client.destroyed || client.closed) {
    client = new H2CClient(origin);
    h2cClients.set(origin, client);
  }
  return client;
}

/** Fetches a URL over HTTP/2. Uses h2c (cleartext) for `http://` URLs and h2 over TLS (via ALPN) for `https://` URLs. Returns a streaming response with a Node Readable body. */
export async function h2Fetch(
  url: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<H2Response> {
  const parsed = new URL(url);
  const dispatcher =
    parsed.protocol === "http:" ? getH2cDispatcher(parsed) : h2Agent;
  const res = await fetch(url, {
    headers: opts.headers,
    dispatcher,
  } as RequestInit);
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    body: res.body
      ? Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
      : null,
  };
}
