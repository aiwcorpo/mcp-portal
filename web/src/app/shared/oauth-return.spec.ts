import { convertToParamMap } from '@angular/router';
import { serverFixture } from '../../testing/fixtures';
import { oauthReturnMessage, readOAuthReturn } from './oauth-return';

describe('oauthReturnMessage', () => {
  const jira = serverFixture('jira', {
    connection: {
      system: 'jira',
      type: 'user-oauth',
      status: 'connected',
      backendUser: 'jkowalski',
      expiresAt: null,
      connectedAt: '2026-10-01T08:00:00Z',
      lastUsedAt: null,
    },
  });

  it('names a system of the catalog', () => {
    const result = readOAuthReturn(
      convertToParamMap({ connectError: 'cancelled', system: 'jira' }),
    )!;
    expect(oauthReturnMessage(result, [jira])).toBe('Connecting to Jira cancelled.');
  });

  it('does not put a system name from the URL into the page when the catalog does not have it', () => {
    const result = readOAuthReturn(
      convertToParamMap({ connectError: 'provider_error', system: 'paypal' }),
    )!;
    expect(oauthReturnMessage(result, [jira])).toBe(
      'The system did not respond correctly. Try again in a moment.',
    );
    expect(oauthReturnMessage(result, null)).toBe(
      'The system did not respond correctly. Try again in a moment.',
    );
    const cancelled = readOAuthReturn(
      convertToParamMap({ connectError: 'cancelled', system: 'paypal' }),
    )!;
    expect(oauthReturnMessage(cancelled, [jira])).toBe('Connection cancelled.');
  });

  it('takes no reserved identifier as a system', () => {
    const result = readOAuthReturn(
      convertToParamMap({ connectError: 'cancelled', system: 'gateway' }),
    )!;
    expect(result.system).toBeNull();
  });

  it('words a success only from the catalog row', () => {
    const result = readOAuthReturn(convertToParamMap({ connected: 'jira' }))!;
    expect(oauthReturnMessage(result, [jira])).toBe('Connected to Jira as jkowalski.');
    expect(oauthReturnMessage(result, [])).toBeNull();
  });
});
