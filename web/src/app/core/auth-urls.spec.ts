import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isAllowedRedirect,
  isValidReturnPath,
  loginUrl,
  safeReturnPath,
  stepUpUrlFor,
} from './auth-urls';

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

  it('refuses the prefixes of the proxy, dot segments and semicolons (CC-099)', () => {
    for (const path of [
      '/api',
      '/api/v1/me',
      '/mcp',
      '/mcp?systems=jira',
      '/s/mcp-jira/mcp',
      '/v/x/mcp',
      '/.well-known/x',
    ]) {
      expect(isValidReturnPath(path)).toBe(false);
    }
    for (const path of ['/./catalog', '/a/../api', '/a/..', '/api;x', '/catalog;x=1']) {
      expect(isValidReturnPath(path)).toBe(false);
    }
    for (const path of [
      '/apiary',
      '/vault',
      '/mcp-docs',
      '/f/x',
      '/catalog?x=/api',
      '/authenticator/register?mfa=ok',
    ]) {
      expect(isValidReturnPath(path)).toBe(true);
    }
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

  it('allows https redirects to OAuth providers, http only on loopback', () => {
    expect(isAllowedRedirect('https://gitlab.internal/oauth/authorize?x=1')).toBe(true);
    expect(isAllowedRedirect('http://localhost:18083/oauth/authorize')).toBe(true);
    expect(isAllowedRedirect('http://127.0.0.1:18083/oauth/authorize')).toBe(true);
    expect(isAllowedRedirect('http://gitlab.internal/oauth/authorize')).toBe(false);
    expect(isAllowedRedirect('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirect('data:text/html,x')).toBe(false);
    expect(isAllowedRedirect('/relative')).toBe(false);
  });

  it('refuses credentials and fragments in the URL', () => {
    expect(isAllowedRedirect('https://iga.internal@other.host/x')).toBe(false);
    expect(isAllowedRedirect('https://user:pw@iga.internal/x')).toBe(false);
    expect(isAllowedRedirect('https://iga.internal/x#frag')).toBe(false);
  });
});

describe('return paths against the contract vectors (5.1.0)', () => {
  const directory = join(
    process.cwd(),
    'node_modules/@aiwcorpo/mcp-contracts/test-vectors/return-paths',
  );
  const vectors = readdirSync(directory).map(
    (file): [string, { value: string; expected: { valid: boolean } }] => [
      file,
      JSON.parse(readFileSync(join(directory, file), 'utf8')),
    ],
  );

  it.each(vectors)('%s', (_file, vector) => {
    expect(isValidReturnPath(vector.value)).toBe(vector.expected.valid);
  });
});
