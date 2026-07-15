/**
 * HMAC-SHA256 utilities for webhook signature verification.
 * Uses the native Web Crypto API available in Deno Deploy.
 */

/**
 * Compute HMAC-SHA256 of a message with a shared secret.
 * Returns a lowercase hex string.
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Verify an inbound webhook signature.
 * Expects: X-PatchWork-Sig: hmac-sha256=<hex>
 */
export async function verifyWebhookSignature(
  secret:    string,
  body:      string,
  sigHeader: string
): Promise<boolean> {
  const expected = 'hmac-sha256=' + await hmacSha256Hex(secret, body)
  return safeCompare(expected, sigHeader)
}

/**
 * Build an outbound Critterverse → PatchWork signature header.
 */
export async function buildOutboundSignature(
  secret:  string,
  body:    string
): Promise<string> {
  return 'hmac-sha256=' + await hmacSha256Hex(secret, body)
}
