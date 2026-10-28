/**
 * RFC 6238 (HMAC-SHA-1, 6 digits, 30 s) for the mock broker and for tests, so the registration can be
 * completed with a code computed from the mock seed. The seed is a test value, never a real secret.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

function base32Decode(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) {
      throw new Error('not Base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export async function totpCode(secretBase32: string, step: number): Promise<string> {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secretBase32) as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

export const stepOf = (epochMillis: number): number =>
  Math.floor(epochMillis / 1000 / STEP_SECONDS);

/** The code the authenticator app shows now. */
export function currentCode(secretBase32: string, now: number = Date.now()): Promise<string> {
  return totpCode(secretBase32, stepOf(now));
}

/** Window of one step either way (contract). */
export async function codeAccepted(
  secretBase32: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  const step = stepOf(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if ((await totpCode(secretBase32, candidate)) === code) {
      return true;
    }
  }
  return false;
}
