import http2 from "node:http2";
import { Readable } from "node:stream";
import { Agent } from "undici";

export interface H2Response {
  status: number;
  ok: boolean;
  headers: Headers;
  body: Readable | null;
}

const h2Agent = new Agent({ allowH2: true });

function h2cFetchInternal(
  url: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<H2Response> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const client = http2.connect(`http://${parsed.host}`);
    client.on("error", reject);
    const reqHeaders: http2.OutgoingHttpHeaders = {
      ":path": parsed.pathname + parsed.search,
      ":method": "GET",
      ...opts.headers,
    };
    const req = client.request(reqHeaders);
    req.on("response", (headers) => {
      const status = Number(headers[":status"]);
      const responseHeaders = new Headers();
      for (const [k, v] of Object.entries(headers)) {
        if (!k.startsWith(":") && v != null) {
          responseHeaders.set(k, String(v));
        }
      }
      resolve({
        status,
        ok: status >= 200 && status < 300,
        headers: responseHeaders,
        body: req,
      });
    });
    req.on("close", () => client.close());
    req.on("error", (err) => {
      client.close();
      reject(err);
    });
    req.end();
  });
}

async function h2FetchInternal(
  url: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<H2Response> {
  const res = await fetch(url, {
    headers: opts.headers,
    dispatcher: h2Agent,
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

/** Fetches a URL over HTTP/2. Uses h2c (cleartext) for `http://` URLs and h2 over TLS (via undici) for `https://` URLs. Returns a streaming response with a Node Readable body. */
export function h2Fetch(
  url: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<H2Response> {
  const protocol = new URL(url).protocol;
  if (protocol === "http:") return h2cFetchInternal(url, opts);
  return h2FetchInternal(url, opts);
}
