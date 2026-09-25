/**
 * Strict base64 decode.
 *
 * Buffer.from(value, "base64") silently ignores characters it does not
 * understand, so a malformed payload would decode to *something* and be
 * carried further into verification. On an authentication path the input is
 * either well-formed or rejected.
 */
export function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");

  return decoded.toString("base64") === value ? decoded : null;
}
