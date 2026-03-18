import sharp from "sharp";
import { SERVICE_URL } from "./setup.js";

export const SOURCE_URL = "http://file-server/test-image.png";

export async function fetchImage(path: string) {
  const url = `${SERVICE_URL}/insecure${path}/plain/${SOURCE_URL}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchImageFrom(path: string, sourceUrl: string) {
  const url = `${SERVICE_URL}/insecure${path}/plain/${sourceUrl}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

/** Convert any image buffer to PNG for jest-image-snapshot comparison. */
export async function toPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).png().toBuffer();
}

export async function fetchImageWithFormat(path: string, format: string) {
  const url = `${SERVICE_URL}/insecure${path}/plain/${SOURCE_URL}@${format}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return { buffer: Buffer.from(await res.arrayBuffer()), res };
}

export { sharp, SERVICE_URL };
