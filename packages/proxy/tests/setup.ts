import { configureToMatchImageSnapshot } from "jest-image-snapshot";
import { afterEach, expect } from "vitest";

const toMatchImageSnapshot = configureToMatchImageSnapshot({
  failureThresholdType: "percent",
  failureThreshold: 0.5,
});

expect.extend({ toMatchImageSnapshot });

afterEach(async () => {
  const { clearProbeCache } = await import("../src/ffprobe.js");
  clearProbeCache();
});

interface InjectableApp {
  inject(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
  }): Promise<any>;
}

type RequestResult = PromiseLike<any> & {
  redirects: (_n: number) => RequestResult;
  set: (key: string, value: string) => RequestResult;
  then: PromiseLike<{
    status: number;
    text: string;
    body: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }>["then"];
};

export function request(app: InjectableApp) {
  return {
    get(url: string) {
      const hdrs: Record<string, string> = {};
      let promise: ReturnType<typeof app.inject> | undefined;
      const fire = () => {
        promise ??= app.inject({ method: "GET", url, headers: hdrs });
        return promise.then((res) => ({
          status: res.statusCode,
          text: res.payload,
          body: Buffer.from(res.rawPayload),
          headers: res.headers,
        }));
      };
      const chain: RequestResult = {
        then: ((onFulfilled: never, onRejected: never) =>
          fire().then(onFulfilled, onRejected)) as RequestResult["then"],
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
