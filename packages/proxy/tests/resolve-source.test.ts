import type { Storage } from "@google-cloud/storage";

import { resolveGcsUrl } from "@/resolve-source.js";

function storageWith(getSignedUrl: () => Promise<[string]>) {
  return {
    bucket: () => ({ file: () => ({ getSignedUrl }) }),
  } as unknown as Storage;
}

describe("resolveGcsUrl", () => {
  it("reuses the signed URL for repeated requests to the same object", async () => {
    const getSignedUrl = vi.fn(
      async (): Promise<[string]> => ["https://signed"],
    );
    const gcs = storageWith(getSignedUrl);
    expect(await resolveGcsUrl("gs://bucket/video.mp4", gcs)).toBe(
      "https://signed",
    );
    expect(await resolveGcsUrl("gs://bucket/video.mp4", gcs)).toBe(
      "https://signed",
    );
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("returns non-gs:// URLs unchanged", async () => {
    const getSignedUrl = vi.fn(
      async (): Promise<[string]> => ["https://signed"],
    );
    expect(
      await resolveGcsUrl(
        "https://example.com/a.mp4",
        storageWith(getSignedUrl),
      ),
    ).toBe("https://example.com/a.mp4");
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("does not cache a failed signing", async () => {
    const getSignedUrl = vi
      .fn<() => Promise<[string]>>()
      .mockRejectedValueOnce(new Error("signBlob failed"))
      .mockResolvedValue(["https://signed"]);
    const gcs = storageWith(getSignedUrl);
    await expect(resolveGcsUrl("gs://bucket/other.mp4", gcs)).rejects.toThrow();
    expect(await resolveGcsUrl("gs://bucket/other.mp4", gcs)).toBe(
      "https://signed",
    );
  });
});
