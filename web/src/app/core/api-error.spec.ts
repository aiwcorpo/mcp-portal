import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { isConnectErrorCode, toApiFailure } from './api-error';
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
    expect(failureMessage(failure)).toBe('Too many requests. Try again in 12 s.');
  });

  it('keeps the request id from the body or X-Request-Id, and only when it is a plain identifier', () => {
    expect(
      toApiFailure(httpError(503, { error: 'upstream_unavailable', requestId: '0192d1b2-7c3a' }))
        .requestId,
    ).toBe('0192d1b2-7c3a');
    expect(toApiFailure(httpError(503, null, { 'X-Request-Id': '0192d1b2-aaaa' })).requestId).toBe(
      '0192d1b2-aaaa',
    );
    expect(
      toApiFailure(httpError(503, { error: 'internal_error', requestId: '<img src=x>' })).requestId,
    ).toBeUndefined();
  });

  it('knows the connect error codes, including cancelled', () => {
    expect(isConnectErrorCode('cancelled')).toBe(true);
    expect(isConnectErrorCode('access_denied')).toBe(false);
  });

  it('never carries the backend message', () => {
    const failure = toApiFailure(
      httpError(400, { error: 'invalid_request', message: 'ORA-00942' }),
    );
    expect(JSON.stringify(failure)).not.toContain('ORA-00942');
    expect(failureMessage(failure)).toBe('The request was rejected as invalid.');
  });
});

describe('toApiFailure of the administrator writes', () => {
  it('keeps the closed reason and the message of a rejected write', () => {
    const failure = toApiFailure(
      httpError(422, {
        error: 'scope_mapping_rejected',
        reason: 'scope_invalid',
        message: 'abc does not match ^[A-Z]+$',
      }),
    );

    expect(failure).toEqual({
      code: 'scope_mapping_rejected',
      status: 422,
      reason: 'scope_invalid',
      message: 'abc does not match ^[A-Z]+$',
    });
    expect(failureMessage(failure)).toContain('does not match the scope pattern');
  });

  it('drops a reason that is not a plain code and a message that is too long', () => {
    const failure = toApiFailure(
      httpError(422, {
        error: 'override_rejected',
        reason: 'Not A Code',
        message: 'x'.repeat(501),
      }),
    );

    expect(failure).toEqual({ code: 'override_rejected', status: 422 });
    expect(failureMessage(failure)).toBe('The gateway did not accept the override.');
  });

  it('shows no backend text for an invalid_request, only for the four administrator rejections', () => {
    const failure = toApiFailure(
      httpError(400, { error: 'invalid_request', message: 'internal detail' }),
    );

    expect(failure.message).toBeUndefined();
  });

  it('keeps the manifestReason of a refused server and explains it', () => {
    const failure = toApiFailure(
      httpError(422, {
        error: 'server_rejected',
        reason: 'manifest_invalid',
        manifestReason: 'environment_mismatch',
        message: 'manifest of mcp-notes declares environment dev',
      }),
    );

    expect(failure.manifestReason).toBe('environment_mismatch');
    expect(failureMessage(failure)).toContain('different environment');
    expect(failureMessage({ ...failure, manifestReason: 'something_new' })).toBe(
      'The manifest of the server failed the checks of the gateway.',
    );
    expect(
      toApiFailure(httpError(422, { error: 'scope_mapping_rejected', manifestReason: 'x' }))
        .manifestReason,
    ).toBeUndefined();
  });

  it('passes the retry wait of a refresh that came too soon and the two connection conflicts', () => {
    const headers = new HttpHeaders({ 'Retry-After': '4' });
    const refresh = toApiFailure(
      new HttpErrorResponse({ status: 429, error: { error: 'refresh_too_frequent' }, headers }),
    );

    expect(refresh).toEqual({ code: 'refresh_too_frequent', status: 429, retryAfterSeconds: 4 });
    expect(toApiFailure(httpError(409, { error: 'connection_changed' })).code).toBe(
      'connection_changed',
    );
    expect(toApiFailure(httpError(409, { error: 'no_pending_connection' })).code).toBe(
      'no_pending_connection',
    );
  });

  it('has its own text for every reason the contract lists', () => {
    const reasons = {
      server_rejected: [
        'address_refused',
        'plain_http_not_allowed',
        'tls_handshake_failed',
        'manifest_unreachable',
        'manifest_invalid',
        'namespace_conflict',
        'tls_mode_not_allowed',
        'system_reserved',
        'credential_types_mixed',
        'credential_type_not_accepted',
      ],
      scope_mapping_rejected: [
        'unknown_resource_type',
        'scope_not_grantable',
        'scope_invalid',
        'group_duplicate',
      ],
      override_rejected: [
        'not_forbid',
        'not_one_policy',
        'id_invalid',
        'target_mismatch',
        'invalid_policy',
        'id_mismatch',
        'target_unknown',
      ],
      system_rejected: [
        'client_secret_required',
        'token_url_not_settable',
        'audience_not_allowed',
        'product_required',
        'exchange_audience_required',
        'system_reserved',
        'default_type_not_supported',
        'credential_types_mixed',
        'oauth_required',
      ],
    } as const;
    for (const [code, list] of Object.entries(reasons)) {
      const generic = failureMessage({ code: code as 'server_rejected', status: 422 });
      for (const reason of list) {
        expect(failureMessage({ code: code as 'server_rejected', status: 422, reason })).not.toBe(
          generic,
        );
      }
    }
  });
});
