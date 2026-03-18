import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HTTPError } from "./error.js";

/** Decrypts an encrypted source URL. The encrypted payload is URL-safe Base64 encoding of: IV (16 bytes) + AES-256-CBC ciphertext. The plaintext is PKCS#7 padded before encryption. */
export function decryptSourceUrl(encoded: string, key: Buffer): string {
  const data = Buffer.from(encoded, "base64url");

  if (data.length < 32) {
    throw new HTTPError("Encrypted payload too short", {
      code: "BAD_REQUEST",
    });
  }

  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/** Encrypts a source URL using AES-256-CBC, returning URL-safe Base64 of IV + ciphertext. */
export function encryptSourceUrl(sourceUrl: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(sourceUrl, "utf-8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64url");
}
