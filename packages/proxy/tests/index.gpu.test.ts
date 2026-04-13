import { Readable } from "node:stream";

/** Encode processes whose completion we control manually. */
const encodeProcs: Array<{
  finish: (code: number) => void;
  stdout: Readable;
  args: string[];
}> = [];

let spawnCallIndex = 0;
let probeWidth = 1920;
let probeHeight = 1080;

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      cb(null, {
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: probeWidth,
              height: probeHeight,
              r_frame_rate: "30/1",
            },
            { codec_type: "audio", codec_name: "aac", profile: "LC" },
          ],
        }),
        stderr: "",
      });
    },
  ),
  spawn: vi.fn((_cmd: string, args: string[]) => {
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
        args: args ?? [],
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
  process.env.GPU_MIN_FRAME_SIZE = "192x192";
  process.env.KEEP_COPYRIGHT = "0";
  process.env.ALLOWED_ORIGINS = "http://file-server,https://example.com";
  process.env.SOURCE_URL_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const { app } = await import("../src/index.js");

/** Wait for an encode process to appear, then auto-finish it. */
async function waitAndFinish(): Promise<string[]> {
  await vi.waitFor(() => expect(encodeProcs.length).toBeGreaterThan(0));
  const proc = encodeProcs[encodeProcs.length - 1];
  proc.finish(0);
  return proc.args;
}

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

describe("GPU frame size fallback", () => {
  afterEach(() => {
    for (const proc of encodeProcs) proc.finish(0);
    encodeProcs.length = 0;
    probeWidth = 1920;
    probeHeight = 1080;
  });

  it("uses GPU when output dimensions are above minimum", async () => {
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:force:480:360/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("h264_nvenc");
  });

  it("falls back to CPU when force resize produces small dimensions", async () => {
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:force:100:100/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
  });

  it("falls back to CPU when fit resize on landscape source produces narrow width", async () => {
    // Source 1920x1080, fit into 200x200 → 200x113 — width ok, height < 192
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:fit:200:200/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
  });

  it("falls back to CPU when fit resize on portrait source produces narrow height", async () => {
    // Source 576x1024, fit into 200x200 → 113x200 — width < 192
    probeWidth = 576;
    probeHeight = 1024;
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:fit:200:200/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
  });

  it("falls back to CPU when width-only resize produces small height", async () => {
    // Source 1920x1080, w:100 → 100x56 — both below 192
    const promise = app.inject({
      method: "GET",
      url: "/insecure/w:100/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
  });

  it("uses GPU for fill resize (output matches target exactly)", async () => {
    // fill 480x360 → always 480x360, above minimum
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:fill:480:360/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("h264_nvenc");
  });

  it("uses GPU for webm output when dimensions are safe", async () => {
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:force:480:360/plain/https://example.com/video.mp4@webm",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("av1_nvenc");
  });

  it("falls back to CPU for webm when dimensions are too small", async () => {
    const promise = app.inject({
      method: "GET",
      url: "/insecure/rs:force:100:100/plain/https://example.com/video.mp4@webm",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("libsvtav1");
    expect(args).not.toContain("av1_nvenc");
  });

  it("falls back to CPU when no resize is specified and source is small", async () => {
    probeWidth = 100;
    probeHeight = 100;
    const promise = app.inject({
      method: "GET",
      url: "/insecure/mu:1/plain/https://example.com/video.mp4",
    });
    const args = await waitAndFinish();
    await promise;
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
  });
});
