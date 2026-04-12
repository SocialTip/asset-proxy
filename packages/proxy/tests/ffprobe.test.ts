import { execFile } from "node:child_process";

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
              width: 1920,
              height: 1080,
              r_frame_rate: "30/1",
            },
            { codec_type: "audio", codec_name: "aac", profile: "LC" },
          ],
        }),
        stderr: "",
      });
    },
  ),
}));

const mockExecFile = vi.mocked(execFile);

const { probeSource } = await import("../src/ffprobe.js");

beforeEach(() => {
  mockExecFile.mockClear();
});

describe("probeSource", () => {
  it("returns probed dimensions, fps, and audio codec", async () => {
    const result = await probeSource("https://example.com/video.mp4");
    expect(result).toEqual({
      audio: { codec: "aac", profile: "LC" },
      width: 1920,
      height: 1080,
      fps: 30,
    });
  });

  it("deduplicates concurrent calls for the same URL", async () => {
    const [a, b] = await Promise.all([
      probeSource("https://example.com/a.mp4"),
      probeSource("https://example.com/a.mp4"),
    ]);

    expect(a).toEqual(b);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate calls for different URLs", async () => {
    await Promise.all([
      probeSource("https://example.com/b.mp4"),
      probeSource("https://example.com/c.mp4"),
    ]);

    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("caches resolved results across sequential calls", async () => {
    await probeSource("https://example.com/d.mp4");
    await probeSource("https://example.com/d.mp4");

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});
