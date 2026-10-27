import { HttpErrorResponse } from '@angular/common/http';
import { ErrorCode, PutSecretError } from '../api/generated';

/**
 * Codes the UI can explain. C10 and the PUT secret errors come from the generated client; the C12
 * generic Error schema has `error: string`, so its codes from CC-012 and the OAuth callback codes from
 * CC-022 are listed here. Anything else collapses to a status-based code, so no backend text reaches
 * the page.
 */
const C12_ERROR_CODES = ['invalid_request', 'csrf_invalid', 'slug_taken', 'hash_mismatch'] as const;
const OAUTH_CALLBACK_ERROR_CODES = ['identity_mismatch', 'flow_invalid', 'provider_error'] as const;

export const PORTAL_ERROR_CODES = [
  ...Object.values(ErrorCode),
  ...Object.values(PutSecretError.ErrorEnum),
  ...C12_ERROR_CODES,
  ...OAUTH_CALLBACK_ERROR_CODES,
] as const;

export type OAuthCallbackErrorCode = (typeof OAUTH_CALLBACK_ERROR_CODES)[number];

export function isOAuthCallbackErrorCode(value: unknown): value is OAuthCallbackErrorCode {
  return (OAUTH_CALLBACK_ERROR_CODES as readonly unknown[]).includes(value);
}

export type PortalErrorCode = (typeof PORTAL_ERROR_CODES)[number];

export interface ApiFailure {
  code: PortalErrorCode;
  status: number;
  /** Only for step_up_required; the caller still validates it before navigating. */
  stepUpUrl?: string;
  retryAfterSeconds?: number;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(PORTAL_ERROR_CODES);

export function isPortalErrorCode(value: unknown): value is PortalErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value);
}

function codeFromStatus(status: number): PortalErrorCode {
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return 'upstream_unavailable';
  }
  if (status === 401) {
    return 'unauthenticated';
  }
  if (status === 403) {
    return 'access_denied';
  }
  if (status === 404) {
    return 'not_found_or_denied';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 400 || status === 422) {
    return 'invalid_request';
  }
  return 'internal_error';
}

function readBody(error: HttpErrorResponse): Record<string, unknown> {
  const body: unknown = error.error;
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export function toApiFailure(error: unknown): ApiFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { code: 'internal_error', status: -1 };
  }
  const body = readBody(error);
  const bodyCode = body['error'];
  const code = isPortalErrorCode(bodyCode) ? bodyCode : codeFromStatus(error.status);
  const failure: ApiFailure = { code, status: error.status };
  if (code === 'step_up_required' && typeof body['stepUpUrl'] === 'string') {
    failure.stepUpUrl = body['stepUpUrl'];
  }
  if (code === 'rate_limited') {
    const retryAfter = Number(body['retryAfterSeconds'] ?? error.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      failure.retryAfterSeconds = retryAfter;
    }
  }
  return failure;
}
