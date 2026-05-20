/**
 * Constant-time string comparison.
 *
 * Used by the cron endpoint to compare Bearer secrets without leaking the
 * actual byte count via timing. Falls back to byte-length-equalisation
 * before calling `crypto.timingSafeEqual`, which requires equal-length
 * Buffers. Empty inputs are rejected so an unset `CRON_SECRET` env var
 * cannot accidentally match an empty Bearer token.
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  // Reject empty-string compare: protects against `process.env.X` being
  // undefined → coerced to "" → matching an attacker-supplied empty token.
  if (aBuf.length === 0 || bBuf.length === 0) return false;

  // Always run timingSafeEqual against equal-length buffers; pad the
  // shorter one so we still consume comparable time before short-circuiting
  // on length. Length is not considered secret (it's a config artefact).
  const maxLen = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(maxLen);
  const bPad = Buffer.alloc(maxLen);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  const equal = timingSafeEqual(aPad, bPad);
  return equal && aBuf.length === bBuf.length;
}
