import http2 from "node:http2";
import { Readable } from "node:stream";

export interface H2Response {
  status: number;
  ok: boolean;
  headers: Headers;
  body: Readable | null;
}

export function h2cFetch(
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
      req.on("end", () => client.close());
      resolve({
        status,
        ok: status >= 200 && status < 300,
        headers: responseHeaders,
        body: req,
      });
    });
    req.on("error", (err) => {
      client.close();
      reject(err);
    });
    req.end();
  });
}
