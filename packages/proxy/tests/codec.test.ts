import {
  type SourceProbe,
  videoCodecString,
  type VideoCodecStringOptions,
} from "../src/codec.js";

function opts(
  overrides: Omit<Partial<VideoCodecStringOptions>, "source"> & {
    width?: number;
    height?: number;
    fps?: number;
    sourceAudio?: SourceProbe["audio"];
  },
): VideoCodecStringOptions {
  const { width, height, fps, sourceAudio, ...rest } = overrides;
  return {
    outputFormat: "mp4",
    mute: undefined,
    resize:
      width || height
        ? { type: "force" as const, width: width ?? 0, height: height ?? 0 }
        : undefined,
    framerate: fps,
    source: {
      audio: sourceAudio,
      width: width ?? 1920,
      height: height ?? 1080,
      fps: fps ?? 30,
    },
    ...rest,
  };
}

describe("videoCodecString", () => {
  describe("mp4", () => {
    it.each([
      {
        desc: "128x128 @ 15fps with AAC-LC passthrough",
        o: opts({
          width: 128,
          height: 128,
          fps: 15,
          sourceAudio: { codec: "aac", profile: "LC" },
        }),
        expected: "avc1.64000a, mp4a.40.2",
      },
      {
        desc: "128x128 @ 15fps with HE-AAC passthrough",
        o: opts({
          width: 128,
          height: 128,
          fps: 15,
          sourceAudio: { codec: "aac", profile: "HE-AAC" },
        }),
        expected: "avc1.64000a, mp4a.40.5",
      },
      {
        desc: "128x128 @ 15fps with non-AAC source (re-encodes to AAC-LC)",
        o: opts({
          width: 128,
          height: 128,
          fps: 15,
          sourceAudio: { codec: "opus", profile: undefined },
        }),
        expected: "avc1.64000a, mp4a.40.2",
      },
      {
        desc: "128x128 @ 15fps muted",
        o: opts({ width: 128, height: 128, fps: 15, mute: true }),
        expected: "avc1.64000a",
      },
      {
        desc: "128x128 @ 15fps no source audio omits audio codec",
        o: opts({ width: 128, height: 128, fps: 15 }),
        expected: "avc1.64000a",
      },
      {
        desc: "480x360 @ 30fps (level 3.0)",
        o: opts({
          width: 480,
          height: 360,
          fps: 30,
          sourceAudio: { codec: "aac", profile: "LC" },
        }),
        expected: "avc1.64001e, mp4a.40.2",
      },
      {
        desc: "1920x1080 @ 30fps (level 4.0)",
        o: opts({
          width: 1920,
          height: 1080,
          fps: 30,
          sourceAudio: { codec: "aac", profile: "LC" },
        }),
        expected: "avc1.640028, mp4a.40.2",
      },
      {
        desc: "3840x2160 @ 30fps (level 5.1)",
        o: opts({
          width: 3840,
          height: 2160,
          fps: 30,
          sourceAudio: { codec: "aac", profile: "LC" },
        }),
        expected: "avc1.640033, mp4a.40.2",
      },
      {
        desc: "7680x4320 @ 30fps (level 6.0)",
        o: opts({
          width: 7680,
          height: 4320,
          fps: 30,
          sourceAudio: { codec: "aac", profile: "LC" },
        }),
        expected: "avc1.64003c, mp4a.40.2",
      },
      {
        desc: "defaults to source dimensions when no resize",
        o: opts({ sourceAudio: { codec: "aac", profile: "LC" } }),
        expected: "avc1.640028, mp4a.40.2",
      },
    ])("$desc → $expected", ({ o, expected }) => {
      expect(videoCodecString(o)).toBe(expected);
    });
  });

  describe("fmp4", () => {
    it("same codecs as mp4", () => {
      const shared = {
        width: 1920,
        height: 1080,
        fps: 30,
        sourceAudio: { codec: "aac", profile: "LC" } as const,
      };
      expect(videoCodecString(opts({ ...shared, outputFormat: "fmp4" }))).toBe(
        videoCodecString(opts({ ...shared, outputFormat: "mp4" })),
      );
    });
  });

  describe("webm", () => {
    it.each([
      {
        desc: "128x128 @ 15fps with audio",
        o: opts({
          outputFormat: "webm",
          width: 128,
          height: 128,
          fps: 15,
          sourceAudio: { codec: "opus", profile: undefined },
        }),
        expected: "av01.0.00M.08, opus",
      },
      {
        desc: "128x128 @ 15fps muted",
        o: opts({
          outputFormat: "webm",
          width: 128,
          height: 128,
          fps: 15,
          mute: true,
        }),
        expected: "av01.0.00M.08",
      },
      {
        desc: "128x128 @ 15fps no source audio omits audio codec",
        o: opts({ outputFormat: "webm", width: 128, height: 128, fps: 15 }),
        expected: "av01.0.00M.08",
      },
      {
        desc: "1920x1080 @ 30fps (level 4.0)",
        o: opts({
          outputFormat: "webm",
          width: 1920,
          height: 1080,
          fps: 30,
          sourceAudio: { codec: "opus", profile: undefined },
        }),
        expected: "av01.0.08M.08, opus",
      },
      {
        desc: "3840x2160 @ 30fps (level 5.0)",
        o: opts({
          outputFormat: "webm",
          width: 3840,
          height: 2160,
          fps: 30,
          sourceAudio: { codec: "opus", profile: undefined },
        }),
        expected: "av01.0.12M.08, opus",
      },
      {
        desc: "3840x2160 @ 60fps (level 5.1)",
        o: opts({
          outputFormat: "webm",
          width: 3840,
          height: 2160,
          fps: 60,
          sourceAudio: { codec: "opus", profile: undefined },
        }),
        expected: "av01.0.13M.08, opus",
      },
      {
        desc: "defaults to source dimensions when no resize",
        o: opts({
          outputFormat: "webm",
          sourceAudio: { codec: "opus", profile: undefined },
        }),
        expected: "av01.0.08M.08, opus",
      },
    ])("$desc → $expected", ({ o, expected }) => {
      expect(videoCodecString(o)).toBe(expected);
    });
  });

  it("returns undefined for unknown format", () => {
    expect(videoCodecString(opts({ outputFormat: "gif" }))).toBeUndefined();
  });
});
