import sharp from "sharp";
import { generateUrl } from "@socialtip/asset-proxy-url-generator";
import { parseProcessingUrl } from "@socialtip/asset-proxy-url-parser";
import { SERVICE_URL, URL_CONFIG } from "./setup.js";

export const SOURCE_URL = "http://file-server/test-image.png";

export async function fetchImage(path: string) {
  const parsed = parseProcessingUrl(`/insecure${path}/plain/${SOURCE_URL}`);
  const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchImageFrom(path: string, sourceUrl: string) {
  const parsed = parseProcessingUrl(`/insecure${path}/plain/${sourceUrl}`);
  const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

/** Convert any image buffer to PNG for jest-image-snapshot comparison. */
export async function toPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).png().toBuffer();
}

export async function fetchImageWithFormat(path: string, format: string) {
  const parsed = parseProcessingUrl(
    `/insecure${path}/plain/${SOURCE_URL}@${format}`,
  );
  const url = `${SERVICE_URL}${generateUrl(parsed, URL_CONFIG)}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return { buffer: Buffer.from(await res.arrayBuffer()), res };
}

export { sharp, SERVICE_URL };
