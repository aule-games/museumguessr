// SHA-256 as lowercase hex, through Web Crypto (the page, the Worker and
// Node all have it). DOM-free. The board's player hash is sha256 of the
// device key's base64url text; the generated name is seeded by it (q3a).

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}
