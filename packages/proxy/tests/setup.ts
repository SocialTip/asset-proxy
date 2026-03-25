import { configureToMatchImageSnapshot } from "jest-image-snapshot";
import { expect } from "vitest";
import type { FastifyInstance } from "fastify";

const toMatchImageSnapshot = configureToMatchImageSnapshot({
  failureThresholdType: "percent",
  failureThreshold: 0.5,
});

expect.extend({ toMatchImageSnapshot });

type RequestResult = Promise<{
  status: number;
  text: string;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}> & {
  buffer: () => RequestResult;
  redirects: (_n: number) => RequestResult;
  set: (key: string, value: string) => RequestResult;
};

export function request(app: FastifyInstance) {
  return {
    get(url: string) {
      const hdrs: Record<string, string> = {};
      let promise: Promise<unknown> | undefined;
      const fire = () => {
        promise ??= app.inject({ method: "GET", url, headers: hdrs });
        return (promise as ReturnType<typeof app.inject>).then((res) => ({
          status: res.statusCode,
          text: res.payload,
          body: Buffer.from(res.rawPayload),
          headers: res.headers,
        }));
      };
      const chain: RequestResult = {
        then: (onFulfilled?: unknown, onRejected?: unknown) =>
          fire().then(onFulfilled as never, onRejected as never),
        catch: (onRejected?: unknown) => fire().catch(onRejected as never),
        finally: (onFinally?: unknown) => fire().finally(onFinally as never),
        [Symbol.toStringTag]: "RequestResult",
        buffer: () => chain,
        redirects: () => chain,
        set(key: string, value: string) {
          hdrs[key] = value;
          return chain;
        },
      };
      return chain;
    },
  };
}
