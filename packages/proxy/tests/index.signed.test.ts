import { PassThrough, Readable } from "node:stream";
import { spawn } from "node:child_process";
import request from "supertest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));
const { mockSave, mockCreateWriteStream, mockFile, mockBucket } = vi.hoisted(
  () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const mockCreateWriteStream = vi.fn();
    const mockFile = vi.fn().mockReturnValue({
      save: mockSave,
      createWriteStream: mockCreateWriteStream,
    });
    const mockBucket = vi.fn().mockReturnValue({ file: mockFile });
    return { mockSave, mockCreateWriteStream, mockFile, mockBucket };
  },
);
vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class {
      bucket = mockBucket;
    },
  };
});

const SIGNING_KEY = "736563726574"; // "secret"
const SIGNING_SALT = "68656c6c6f"; // "hello"
const ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.hoisted(() => {
  process.env.SKIP_GPU = "1";
  process.env.KEEP_COPYRIGHT = "0";
  process.env.ALLOWED_ORIGINS = "http://file-server,https://example.com";
  process.env.CACHE_BUCKET = "test-cache-bucket";
  process.env.SIGNING_KEY = "736563726574";
  process.env.SIGNING_SALT = "68656c6c6f";
  process.env.SOURCE_URL_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const { generateUrl } = await import("@socialtip/asset-proxy-url-generator");
const { app } = await import("../src/index.js");

const mockSpawn = vi.mocked(spawn);

function setupSpawnMock() {
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
    pid: 1,
  };
  mockSpawn.mockReturnValue(proc as never);
  process.nextTick(() => {
    stdout.push(Buffer.from("fake"));
    stdout.push(null);
    stdout.on("end", () => {
      for (const cb of listeners.get("close") ?? []) cb(0 as never);
    });
  });
  return proc;
}

const urlConfig = {
  signingKey: SIGNING_KEY,
  signingSalt: SIGNING_SALT,
};

beforeEach(() => {
  mockSpawn.mockReset();
  mockSave.mockClear();
  mockFile.mockClear();
  mockCreateWriteStream.mockReset().mockImplementation(() => new PassThrough());
});

describe("cache bucket with signed URLs", () => {
  it("writes to cache with signed plain URL as key", async () => {
    setupSpawnMock();
    const path = generateUrl(
      {
        sourceUrl: "https://example.com/photo.jpg",
        resize: { type: "fit", width: 100 },
      },
      urlConfig,
    );
    const res = await request(app).get(path).buffer(true);

    expect(res.status).toBe(200);
    expect(mockFile).toHaveBeenCalledWith(encodeURIComponent(path));
    expect(mockSave).toHaveBeenCalledWith(expect.any(Buffer), {
      contentType: "image/jpeg",
    });
  });

  it("writes to cache with signed encrypted URL as key", async () => {
    setupSpawnMock();
    const path = generateUrl(
      {
        sourceUrl: "https://example.com/photo.jpg",
        resize: { type: "fit", width: 100 },
      },
      { ...urlConfig, encryptionKey: ENCRYPTION_KEY },
    );
    const res = await request(app).get(path).buffer(true);

    expect(res.status).toBe(200);
    expect(mockFile).toHaveBeenCalledWith(encodeURIComponent(path));
    expect(mockSave).toHaveBeenCalledWith(expect.any(Buffer), {
      contentType: "image/jpeg",
    });
  });
});
