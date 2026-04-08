import { Readable } from "node:stream";

/** Encode processes whose completion we control manually. */
const encodeProcs: Array<{
  finish: (code: number) => void;
  stdout: Readable;
}> = [];

let spawnCallIndex = 0;

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => {
    spawnCallIndex++;
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const listeners = new Map<string, ((...args: never[]) => void)[]>();
    const proc = {
      stdout,
      stderr,
      stdin: new Readable({ read() {} }),
      kill: vi.fn(),
      on: vi.fn((event: string, cb: (...args: never[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(cb);
      }),
      pid: spawnCallIndex,
    };

    if (spawnCallIndex === 1) {
      // First spawn is the GPU readiness probe — succeed immediately
      process.nextTick(() => {
        for (const cb of listeners.get("close") ?? []) cb(0 as never);
      });
    } else {
      // Subsequent spawns are video encodes — hang until finish() is called
      encodeProcs.push({
        stdout,
        finish: (code: number) => {
          if (code === 0) {
            stdout.push(Buffer.from("fake"));
            stdout.push(null);
          }
          stdout.on("end", () => {
            for (const cb of listeners.get("close") ?? []) cb(code as never);
          });
          if (code !== 0) {
            stdout.push(null);
          }
        },
      });
    }

    return proc;
  }),
}));
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket = vi.fn().mockReturnValue({
      file: vi.fn().mockReturnValue({
        getSignedUrl: vi.fn().mockResolvedValue(["https://signed-url"]),
      }),
    });
  },
}));

vi.hoisted(() => {
  delete process.env.SKIP_GPU;
  process.env.GPU_CONCURRENCY = "1";
  process.env.GPU_ACQUIRE_TIMEOUT_MS = "200";
  process.env.KEEP_COPYRIGHT = "0";
  process.env.ALLOWED_ORIGINS = "http://file-server,https://example.com";
  process.env.SOURCE_URL_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const { app } = await import("../src/index.js");

describe("GPU concurrency limit", () => {
  afterEach(() => {
    for (const proc of encodeProcs) proc.finish(0);
    encodeProcs.length = 0;
  });

  it("returns 429 with Retry-After when GPU slot cannot be acquired within timeout", async () => {
    // Fire the first request (grabs the only GPU slot; stream never closes)
    const first = app.inject({
      method: "GET",
      url: "/insecure/w:480/plain/https://example.com/video.mp4@webm",
    });

    // Give the first request time to acquire the GPU slot
    await new Promise((r) => setTimeout(r, 50));

    // Second request should timeout waiting for the GPU slot (5s)
    const second = await app.inject({
      method: "GET",
      url: "/insecure/w:480/plain/https://example.com/video2.mp4@webm",
    });

    expect(second.statusCode).toBe(429);
    expect(second.payload).toBe("GPU busy, try again later");
    expect(second.headers["retry-after"]).toBe("5");

    // Release the first request's GPU slot and wait for it to complete
    for (const proc of encodeProcs) proc.finish(0);
    await first.catch(() => {});
    encodeProcs.length = 0;
    await new Promise((r) => setTimeout(r, 50));

    // Retry — the slot is now free so this should succeed (not 429).
    // Auto-finish the encode once it starts so the stream completes.
    const retryPromise = app.inject({
      method: "GET",
      url: "/insecure/w:480/plain/https://example.com/video.mp4@webm",
    });
    await new Promise((r) => setTimeout(r, 50));
    for (const proc of encodeProcs) proc.finish(0);
    const retry = await retryPromise;

    expect(retry.statusCode).not.toBe(429);
  });
});
