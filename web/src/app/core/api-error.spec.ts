import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { toApiFailure } from './api-error';
import { failureMessage } from './error-messages';

function httpError(status: number, error: unknown, headers?: Record<string, string>) {
  return new HttpErrorResponse({ status, error, headers: new HttpHeaders(headers) });
}

describe('toApiFailure', () => {
  it('keeps known codes from the body', () => {
    expect(toApiFailure(httpError(422, { error: 'secret_invalid' })).code).toBe('secret_invalid');
    expect(toApiFailure(httpError(403, { error: 'csrf_invalid' })).code).toBe('csrf_invalid');
  });

  it('takes stepUpUrl only for step_up_required', () => {
    const failure = toApiFailure(
      httpError(401, { error: 'step_up_required', stepUpUrl: '/api/v1/auth/login?stepUp=true' }),
    );
    expect(failure).toEqual({
      code: 'step_up_required',
      status: 401,
      stepUpUrl: '/api/v1/auth/login?stepUp=true',
    });
  });

  it('falls back to a code from the HTTP status for unknown codes', () => {
    expect(toApiFailure(httpError(500, { error: 'NullPointerException' })).code).toBe(
      'internal_error',
    );
    expect(toApiFailure(httpError(503, 'Service Unavailable')).code).toBe('upstream_unavailable');
    expect(toApiFailure(httpError(0, null)).code).toBe('upstream_unavailable');
    expect(toApiFailure(httpError(404, null)).code).toBe('not_found_or_denied');
    expect(toApiFailure(new Error('boom')).code).toBe('internal_error');
  });

  it('reads Retry-After for rate limiting', () => {
    const failure = toApiFailure(
      httpError(429, { error: 'rate_limited' }, { 'Retry-After': '12' }),
    );
    expect(failure.retryAfterSeconds).toBe(12);
    expect(failureMessage(failure)).toBe('Za dużo żądań. Spróbuj ponownie za 12 s.');
  });

  it('never carries the backend message', () => {
    const failure = toApiFailure(
      httpError(400, { error: 'invalid_request', message: 'ORA-00942' }),
    );
    expect(JSON.stringify(failure)).not.toContain('ORA-00942');
    expect(failureMessage(failure)).toBe('Żądanie zostało odrzucone jako niepoprawne.');
  });
});
