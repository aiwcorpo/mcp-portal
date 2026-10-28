import { SLUG_PATTERN, suggestSlug } from './slug';

describe('suggestSlug', () => {
  it.each([
    ['Przegląd zgłoszeń', 'przeglad-zgloszen'],
    ['Zażółć gęślą jaźń', 'zazolc-gesla-jazn'],
    ['  Release   notes!  ', 'release-notes'],
    ['Code-review (v2)', 'code-review-v2'],
    ['', ''],
    ['!!!', ''],
  ])('%j -> %j', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });

  it('never exceeds 63 characters or ends with a hyphen, and always matches the contract pattern', () => {
    const slug = suggestSlug(`${'a'.repeat(62)} b`);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith('-')).toBe(false);
    expect(SLUG_PATTERN.test(slug)).toBe(true);
  });
});

describe('SLUG_PATTERN', () => {
  it('follows VirtualServerSlug', () => {
    expect(SLUG_PATTERN.test('a')).toBe(true);
    expect(SLUG_PATTERN.test('team-a-dev')).toBe(true);
    expect(SLUG_PATTERN.test('-a')).toBe(false);
    expect(SLUG_PATTERN.test('a-')).toBe(false);
    expect(SLUG_PATTERN.test('A')).toBe(false);
    expect(SLUG_PATTERN.test('a'.repeat(64))).toBe(false);
  });
});
