import { MOCK_TOTP_SEED } from './m3-mock';
import { codeAccepted, currentCode, stepOf, totpCode } from './totp';

/** RFC 6238 appendix B: the seed "12345678901234567890" is the mock seed in Base32. */
describe('mock TOTP', () => {
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_234_567_890, '005924'],
  ])('computes the RFC 6238 code at %i s', async (seconds, expected) => {
    expect(await totpCode(MOCK_TOTP_SEED, stepOf(seconds * 1000))).toBe(expected);
  });

  it('accepts one step either way and nothing else', async () => {
    const now = 1_700_000_015_000;
    const previous = await totpCode(MOCK_TOTP_SEED, stepOf(now) - 1);
    const twoBack = await totpCode(MOCK_TOTP_SEED, stepOf(now) - 2);
    expect(await codeAccepted(MOCK_TOTP_SEED, await currentCode(MOCK_TOTP_SEED, now), now)).toBe(
      true,
    );
    expect(await codeAccepted(MOCK_TOTP_SEED, previous, now)).toBe(true);
    expect(await codeAccepted(MOCK_TOTP_SEED, twoBack, now)).toBe(false);
  });
});
