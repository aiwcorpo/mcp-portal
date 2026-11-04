import { chooseLocale } from './locale';

describe('chooseLocale', () => {
  it('prefers the stored choice over the browser', () => {
    expect(chooseLocale('pl', ['en-US'])).toBe('pl');
    expect(chooseLocale('en', ['pl-PL'])).toBe('en');
  });

  it('takes the first browser language the portal has', () => {
    expect(chooseLocale(null, ['de-DE', 'pl-PL', 'en-US'])).toBe('pl');
    expect(chooseLocale(null, ['fr', 'EN-gb'])).toBe('en');
  });

  it('falls back to English, also for an unknown stored value', () => {
    expect(chooseLocale(null, ['de-DE'])).toBe('en');
    expect(chooseLocale('xx', [])).toBe('en');
  });
});
