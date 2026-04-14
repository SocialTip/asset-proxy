import { parseInfoUrl } from "@socialtip/asset-proxy-url-parser";

const SRC = "https://example.com/photo.jpg";

describe("parseInfoUrl", () => {
  describe("default-true options", () => {
    it("defaults size, format, dimensions, videoMeta to true", () => {
      const result = parseInfoUrl(`/plain/${SRC}`);
      expect(result.infoOptions.size).toBe(true);
      expect(result.infoOptions.format).toBe(true);
      expect(result.infoOptions.dimensions).toBe(true);
      expect(result.infoOptions.videoMeta).toBe(true);
    });

    it("disables size with size:0", () => {
      const result = parseInfoUrl(`/size:0/plain/${SRC}`);
      expect(result.infoOptions.size).toBe(false);
    });

    it("disables size with size:f", () => {
      const result = parseInfoUrl(`/size:f/plain/${SRC}`);
      expect(result.infoOptions.size).toBe(false);
    });

    it("disables size with size:false", () => {
      const result = parseInfoUrl(`/size:false/plain/${SRC}`);
      expect(result.infoOptions.size).toBe(false);
    });

    it("keeps size enabled with size:t", () => {
      const result = parseInfoUrl(`/size:t/plain/${SRC}`);
      expect(result.infoOptions.size).toBe(true);
    });

    it("disables format with f:0", () => {
      const result = parseInfoUrl(`/f:0/plain/${SRC}`);
      expect(result.infoOptions.format).toBe(false);
    });

    it("disables format with format:f", () => {
      const result = parseInfoUrl(`/format:f/plain/${SRC}`);
      expect(result.infoOptions.format).toBe(false);
    });

    it("disables dimensions with d:0", () => {
      const result = parseInfoUrl(`/d:0/plain/${SRC}`);
      expect(result.infoOptions.dimensions).toBe(false);
    });

    it("disables dimensions with dimensions:false", () => {
      const result = parseInfoUrl(`/dimensions:false/plain/${SRC}`);
      expect(result.infoOptions.dimensions).toBe(false);
    });

    it("disables videoMeta with vm:0", () => {
      const result = parseInfoUrl(`/vm:0/plain/${SRC}`);
      expect(result.infoOptions.videoMeta).toBe(false);
    });

    it("disables videoMeta with video_meta:f", () => {
      const result = parseInfoUrl(`/video_meta:f/plain/${SRC}`);
      expect(result.infoOptions.videoMeta).toBe(false);
    });

    it("supports multiple disabled options together", () => {
      const result = parseInfoUrl(`/size:0/f:0/d:0/vm:0/plain/${SRC}`);
      expect(result.infoOptions.size).toBe(false);
      expect(result.infoOptions.format).toBe(false);
      expect(result.infoOptions.dimensions).toBe(false);
      expect(result.infoOptions.videoMeta).toBe(false);
    });
  });

  describe("opt-in options", () => {
    it("defaults opt-in options to undefined", () => {
      const result = parseInfoUrl(`/plain/${SRC}`);
      expect(result.infoOptions.exif).toBeUndefined();
      expect(result.infoOptions.iptc).toBeUndefined();
      expect(result.infoOptions.xmp).toBeUndefined();
      expect(result.infoOptions.colorspace).toBeUndefined();
    });

    it("enables exif with exif:t", () => {
      const result = parseInfoUrl(`/exif:t/plain/${SRC}`);
      expect(result.infoOptions.exif).toBe(true);
    });
  });
});
