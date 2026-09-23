import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { WEBHOOK_SIGNATURE_PREFIX } from "@rushsite/shared"

export function signBody(body: string | Buffer, secret: string): string {
  return WEBHOOK_SIGNATURE_PREFIX + createHmac("sha256", secret).update(body).digest("hex")
}

// Constant time check of an X-Rushsite-Signature header against the raw body
export function verifySignature(body: string | Buffer, secret: string, header: string | undefined | null): boolean {
  if (!header || !header.startsWith(WEBHOOK_SIGNATURE_PREFIX)) return false
  const given = header.slice(WEBHOOK_SIGNATURE_PREFIX.length).trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(given)) return false
  const expected = createHmac("sha256", secret).update(body).digest()
  return timingSafeEqual(Buffer.from(given, "hex"), expected)
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url")
}

// Server passwords go into a console connect string so keep them alphanumeric
export function randomPassword(length = 16): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(length)
  let out = ""
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}
