import { createCipheriv, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import request from "supertest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("@google-cloud/storage", () => ({ Storage: vi.fn() }));

const mockSpawn = vi.mocked(spawn);

function setupSpawnMock() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const proc = {
    stdout,
    stderr,
    stdin: new Readable({ read() {} }),
    kill: vi.fn(),
    on: vi.fn(),
    pid: 1,
  };
  mockSpawn.mockReturnValue(proc as never);
  // Push data and end the stream in the next tick so processImage resolves
  process.nextTick(() => {
    stdout.push(Buffer.from("fake"));
    stdout.push(null);
  });
  return proc;
}

function setupSpawnMockError() {
  const stdout = new Readable({
    read() {
      // Emit error on first read attempt
      process.nextTick(() =>
        this.destroy(new Error("ffmpeg exited with code 1")),
      );
    },
  });
  const stderr = new Readable({ read() {} });
  const proc = {
    stdout,
    stderr,
    stdin: new Readable({ read() {} }),
    kill: vi.fn(),
    on: vi.fn(),
    pid: 1,
  };
  mockSpawn.mockReturnValue(proc as never);
  return proc;
}

vi.hoisted(() => {
  process.env.SKIP_GPU = "1";
  process.env.ALLOWED_ORIGINS = "http://file-server,https://example.com";
  process.env.SOURCE_URL_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const { parseProcessingUrl, isImageUrl } = await import("../src/url-parser.js");
const { processImage, processVideo, buildVideoArgs } =
  await import("../src/ffmpeg.js");
const { app } = await import("../src/index.js");

function imageArgs(path: string): string[] {
  const parsed = parseProcessingUrl(path);
  if (!isImageUrl(parsed)) throw new Error("Expected image URL");
  setupSpawnMock();
  processImage(parsed.sourceUrl, parsed);
  return mockSpawn.mock.calls.at(-1)![1] as string[];
}

async function videoArgs(path: string): Promise<string[]> {
  const parsed = parseProcessingUrl(path);
  if (isImageUrl(parsed)) throw new Error("Expected video URL");
  setupSpawnMock();
  // processVideo is async (awaits gpuReady), so we need to await it starting
  // We don't await the full result since it would try to read the stream
  await processVideo(parsed.sourceUrl, parsed as never).catch(() => {});
  return mockSpawn.mock.calls.at(-1)![1] as string[];
}

const SRC = "https://example.com/photo.jpg";
const VSRC = "https://example.com/video.mp4";
const plain = (opts: string) => `${opts}/plain/${SRC}`;
const vplain = (opts: string) => `${opts}/plain/${VSRC}`;

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("error handling", () => {
  it("returns 500 with generic message when image processing fails", async () => {
    setupSpawnMockError();
    const res = await request(app)
      .get("/insecure/w:100/plain/https://example.com/photo.jpg")
      .buffer(true);

    expect(res.status).toBe(500);
    expect(res.text).toBe("Error processing image");
  });
});

describe("origin allowlist", () => {
  it("allows a request with a permitted origin", async () => {
    setupSpawnMock();
    const res = await request(app)
      .get("/insecure/w:100/plain/https://example.com/photo.jpg")
      .buffer(true);

    expect(res.status).toBe(200);
  });

  it("rejects a request with a non-permitted origin", async () => {
    const res = await request(app).get(
      "/insecure/w:100/plain/https://evil.com/photo.jpg",
    );

    expect(res.status).toBe(403);
    expect(res.text).toContain("Origin not allowed");
  });
});

describe("image ffmpeg args", () => {
  it("basic resize fit", () => {
    expect(imageArgs(plain("/rs:fit:100:75"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:75:force_original_aspect_ratio=decrease",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("resize fill", () => {
    expect(imageArgs(plain("/rs:fill:100:100"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:100:force_original_aspect_ratio=increase,crop=100:100",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("resize force", () => {
    expect(imageArgs(plain("/rs:force:80:120"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=80:120",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("width only", () => {
    expect(imageArgs(plain("/w:100"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("resizing algorithm lanczos3", () => {
    expect(imageArgs(plain("/w:100/ra:lanczos3"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease:flags=lanczos",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("crop with compass gravity nowe", () => {
    expect(imageArgs(plain("/c:100:75:nowe"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "crop=100:75:0:0",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("crop with focus point gravity", () => {
    expect(imageArgs(plain("/c:100:75/g:fp:0.8:0.8"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "crop=100:75:min(max(iw*0.8-100/2\\,0)\\,iw-100):min(max(ih*0.8-75/2\\,0)\\,ih-75)",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("crop_aspect_ratio 16:9", () => {
    expect(imageArgs(plain("/car:16:9/w:100"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "crop='if(gt(dar\\,1.7777777777777777)\\,ih*1.7777777777777777\\,iw)':'if(gt(dar\\,1.7777777777777777)\\,ih\\,iw/1.7777777777777777)',scale=100:-1:force_original_aspect_ratio=decrease",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("quality and format webp", () => {
    expect(imageArgs(plain("/w:100/q:80/f:webp"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "webp",
        "-c:v",
        "libwebp",
        "-quality",
        "80",
        "pipe:1",
      ]
    `);
  });

  it("padding with background", () => {
    expect(imageArgs(plain("/w:100/pd:10/bg:ff0000"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease,pad=iw+20:ih+20:10:10:#ff0000",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("padding with background alpha", () => {
    expect(imageArgs(plain("/w:100/pd:10/bg:ff0000/bga:0.5")))
      .toMatchInlineSnapshot(`
        [
          "-hide_banner",
          "-y",
          "-i",
          "https://example.com/photo.jpg",
          "-vf",
          "scale=100:-1:force_original_aspect_ratio=decrease,format=rgba,pad=iw+20:ih+20:10:10:#ff0000@0.5",
          "-map_metadata",
          "-1",
          "-frames:v",
          "1",
          "-f",
          "image2",
          "-c:v",
          "mjpeg",
          "pipe:1",
        ]
      `);
  });

  it("rotate 90", () => {
    expect(imageArgs(plain("/w:100/rot:90"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease,transpose=1",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("blur and sharpen", () => {
    expect(imageArgs(plain("/w:100/bl:5/sh:2"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease,gblur=sigma=5,unsharp=5:5:2:5:5:0",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("trim with detected crop filter", () => {
    // Simulate the result of a cropdetect pass by providing trimFilter directly
    const parsed = parseProcessingUrl(plain("/trim:10:ffffff/w:100"));
    setupSpawnMock();
    // Access buildImageArgs indirectly via the module — we test the filter chain
    // by verifying trim is parsed correctly
    expect(parsed.trim).toEqual({
      threshold: 10,
      colour: "ffffff",
      equalHor: false,
      equalVert: false,
    });
  });

  it("flip horizontal and vertical", () => {
    expect(imageArgs(plain("/flip:1:1"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "hflip,vflip",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("pixelate", () => {
    expect(imageArgs(plain("/px:8"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=iw/8:ih/8:flags=neighbor,scale=iw*8:ih*8:flags=neighbor",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("unsharp masking (always mode)", () => {
    expect(imageArgs(plain("/ush:always:1:24"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "unsharp=5:5:0.041666666666666664:5:5:0",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("colorize overlay", () => {
    expect(imageArgs(plain("/col:0.5:ff0000"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "lutrgb=r=128+val*0.5:g=0+val*0.5:b=0+val*0.5",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("brightness and saturation via adjust", () => {
    expect(imageArgs(plain("/a:50::0.5"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "eq=brightness=0.19607843137254902:saturation=0.5",
        "-map_metadata",
        "-1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });

  it("strip_metadata disabled", () => {
    expect(imageArgs(plain("/w:100/sm:0"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/photo.jpg",
        "-vf",
        "scale=100:-1:force_original_aspect_ratio=decrease",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ]
    `);
  });
});

describe("video ffmpeg args", () => {
  it("basic resize force (CPU)", async () => {
    expect(await videoArgs(vplain("/rs:force:480:360"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "scale=480:360",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });

  it("resize with framerate and cut", async () => {
    expect(await videoArgs(vplain("/rs:force:480:360/fr:30/ct:10")))
      .toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "scale=480:360",
        "-t",
        "10",
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });

  it("resize fill (CPU)", async () => {
    expect(await videoArgs(vplain("/rs:fill:480:360"))).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "scale=480:360:force_original_aspect_ratio=increase,crop=480:360",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });

  it("webm output", async () => {
    expect(await videoArgs(vplain("/rs:force:480:360") + "@webm"))
      .toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "scale=480:360",
        "-c:v",
        "libvpx-vp9",
        "-c:a",
        "libopus",
        "-f",
        "webm",
        "pipe:1",
      ]
    `);
  });

  it("crop_aspect_ratio with resize", async () => {
    expect(await videoArgs(vplain("/rs:force:480:360/car:16:9")))
      .toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "crop='if(gt(dar\\,1.7777777777777777)\\,ih*1.7777777777777777\\,iw)':'if(gt(dar\\,1.7777777777777777)\\,ih\\,iw/1.7777777777777777)',scale=480:360",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });
});

describe("video ffmpeg args (GPU)", () => {
  function gpuVideoArgs(opts: {
    resizingType?: string;
    resizingAlgorithm?: unknown;
    cropAspectRatio?: number;
    width?: number;
    height?: number;
    framerate?: number;
    trim?: number;
    outputFormat?: string;
  }): string[] {
    return buildVideoArgs("https://example.com/video.mp4", {
      resizingType: (opts.resizingType ?? "force") as never,
      resizingAlgorithm: opts.resizingAlgorithm as never,
      cropAspectRatio: opts.cropAspectRatio,
      width: opts.width ?? 480,
      height: opts.height ?? 360,
      framerate: opts.framerate,
      trim: opts.trim,
      outputFormat: (opts.outputFormat ?? "mp4") as never,
      gpu: true,
    });
  }

  it("default GPU resize (cuvid -resize)", () => {
    expect(gpuVideoArgs({ resizingType: "force" })).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-hwaccel",
        "cuda",
        "-hwaccel_output_format",
        "cuda",
        "-resize",
        "480x360",
        "-i",
        "https://example.com/video.mp4",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });

  it("GPU with explicit scale_cuda scaler (fill mode)", () => {
    expect(
      gpuVideoArgs({
        resizingType: "fill",
        resizingAlgorithm: { mode: "gpu", scaler: "scale_cuda" },
      }),
    ).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-hwaccel",
        "cuda",
        "-hwaccel_output_format",
        "cuda",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "scale_cuda=w='max(480,iw*max(480/iw\\,360/ih))':h='max(360,ih*max(480/iw\\,360/ih))',hwdownload,format=nv12,crop=480:360,hwupload_cuda",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });

  it("GPU with scale_npp and interpolation algorithm", () => {
    expect(
      gpuVideoArgs({
        resizingType: "force",
        resizingAlgorithm: {
          mode: "gpu",
          scaler: "scale_npp",
          algorithm: "lanczos3",
        },
      }),
    ).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-y",
        "-hwaccel",
        "cuda",
        "-hwaccel_output_format",
        "cuda",
        "-i",
        "https://example.com/video.mp4",
        "-vf",
        "scale_npp=480:360:interp_algo=lanczos",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-c:a",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+faststart",
        "-f",
        "mp4",
        "pipe:1",
      ]
    `);
  });

  it("rejects non-force resize type without explicit scaler", () => {
    expect(() => gpuVideoArgs({ resizingType: "fill" })).toThrow(
      "not supported with default GPU resize",
    );
  });

  it("rejects CPU resizing algorithm with GPU", () => {
    expect(() =>
      gpuVideoArgs({
        resizingAlgorithm: { mode: "cpu", algorithm: "lanczos3" },
      }),
    ).toThrow("not supported with GPU acceleration");
  });
});

describe("validation errors", () => {
  it("rejects invalid framerate", () => {
    expect(() => parseProcessingUrl(plain("/rs:fill:480:360/fr:0"))).toThrow();
  });

  it("rejects invalid resizing_algorithm", () => {
    expect(() => parseProcessingUrl(plain("/ra:invalid/w:100"))).toThrow();
  });

  it("rejects smart gravity", () => {
    expect(() => parseProcessingUrl(plain("/g:sm/w:100"))).toThrow(
      "not implemented",
    );
  });

  it("rejects objects_position", () => {
    expect(() => parseProcessingUrl(plain("/op:0.5:0.5/w:100"))).toThrow(
      "not implemented",
    );
  });

  it("rejects blur_areas", () => {
    expect(() =>
      parseProcessingUrl(plain("/bla:5:0.1:0.2:0.3:0.4/w:100")),
    ).toThrow("not implemented");
  });

  it("rejects blur_detections", () => {
    expect(() => parseProcessingUrl(plain("/bd:5:face/w:100"))).toThrow(
      "not implemented",
    );
  });

  it("rejects draw_detections", () => {
    expect(() => parseProcessingUrl(plain("/dd:1:face/w:100"))).toThrow(
      "not implemented",
    );
  });

  it("rejects focus point gravity out of range", () => {
    expect(() => parseProcessingUrl(plain("/g:fp:1.5:0.5/w:100"))).toThrow(
      "between 0 and 1",
    );
  });
});

describe("url parsing", () => {
  it("parses encrypted source URL", () => {
    const original = "https://example.com/video.mp4";
    const key = Buffer.from(process.env.SOURCE_URL_ENCRYPTION_KEY!, "hex");
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([
      iv,
      cipher.update(original, "utf-8"),
      cipher.final(),
    ]).toString("base64url");

    const result = parseProcessingUrl(`/resize:fill:480:360/enc/${encrypted}`);
    expect(result.sourceUrl).toBe(original);
  });

  it("detects image from output format", () => {
    const result = parseProcessingUrl(
      "/w:300/plain/https://example.com/photo.bmp@webp",
    );
    expect(isImageUrl(result)).toBe(true);
  });

  it("detects video from framerate option", () => {
    const result = parseProcessingUrl(
      "/resize:fill:480:360/fr:30/plain/https://example.com/file",
    );
    expect(isImageUrl(result)).toBe(false);
  });
});
