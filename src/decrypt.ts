import { createDecipheriv } from "node:crypto";
import { env } from "./env.js";
import { HTTPError } from "./error.js";

/**
 * Decrypts an encrypted source URL.
 *
 * The encrypted payload is URL-safe Base64 encoding of: IV (16 bytes) + AES-256-CBC ciphertext.
 * The plaintext is PKCS#7 padded before encryption.
 */
export function decryptSourceUrl(encoded: string): string {
  const key = env.SOURCE_URL_ENCRYPTION_KEY;
  if (!key) {
    throw new HTTPError(
      "Encrypted source URLs are not supported: SOURCE_URL_ENCRYPTION_KEY is not set",
      { code: "BAD_REQUEST" },
    );
  }

  const data = Buffer.from(encoded, "base64url");

  if (data.length < 32) {
    throw new HTTPError("Encrypted payload too short", {
      code: "BAD_REQUEST",
    });
  }

  // First 16 bytes are the IV, rest is ciphertext
  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}
