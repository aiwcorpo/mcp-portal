import { isHttpUrl, isValidReturnPath, loginUrl, safeReturnPath, stepUpUrlFor } from './auth-urls';

const ORIGIN = 'https://mcp-portal.internal';

describe('auth URLs', () => {
  it('accepts only portal-relative return paths without percent-encoding (CC-032)', () => {
    expect(isValidReturnPath('/connect/jira?stepUp=done&expiresAt=2027-01-31')).toBe(true);
    expect(isValidReturnPath('//evil.example')).toBe(false);
    expect(isValidReturnPath('/%2F%2Fevil')).toBe(false);
    expect(isValidReturnPath('/\\evil')).toBe(false);
    expect(isValidReturnPath('https://evil.example/')).toBe(false);
    expect(isValidReturnPath(`/${'a'.repeat(512)}`)).toBe(false);
    expect(safeReturnPath('//evil')).toBe('/');
  });

  it('builds the BFF login URL', () => {
    expect(loginUrl('/catalog')).toBe('/api/v1/auth/login?returnPath=%2Fcatalog');
    expect(loginUrl('/catalog', true)).toBe('/api/v1/auth/login?returnPath=%2Fcatalog&stepUp=true');
  });

  it('points stepUpUrl back at the form', () => {
    const url = stepUpUrlFor(
      '/api/v1/auth/login?stepUp=true&returnPath=/catalog',
      '/connect/jira?stepUp=done',
      ORIGIN,
    );
    const parsed = new URL(url, ORIGIN);
    expect(parsed.pathname).toBe('/api/v1/auth/login');
    expect(parsed.searchParams.get('returnPath')).toBe('/connect/jira?stepUp=done');
    expect(parsed.searchParams.get('stepUp')).toBe('true');
  });

  it('ignores a stepUpUrl that leaves the BFF login endpoint', () => {
    const fallback = '/api/v1/auth/login?returnPath=%2Fconnect%2Fjira&stepUp=true';
    expect(stepUpUrlFor('https://evil.example/api/v1/auth/login', '/connect/jira', ORIGIN)).toBe(
      fallback,
    );
    expect(stepUpUrlFor('/api/v1/other', '/connect/jira', ORIGIN)).toBe(fallback);
    expect(stepUpUrlFor(undefined, '/connect/jira', ORIGIN)).toBe(fallback);
  });

  it('allows only http(s) redirects to OAuth providers', () => {
    expect(isHttpUrl('https://gitlab.internal/oauth/authorize?x=1')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,x')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
});
