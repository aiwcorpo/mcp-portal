import { HttpErrorResponse } from '@angular/common/http';
import { ConnectErrorCode, ErrorCode, PutSecretError } from '../api/generated';

/**
 * Codes the UI can explain. C10 and the PUT secret errors come from the generated client; the C12
 * generic Error schema has `error: string`, so its codes from CC-012 and the OAuth callback codes from
 * CC-022 are listed here. Anything else collapses to a status-based code, so no backend text reaches
 * the page.
 */
const C12_ERROR_CODES = [
  'invalid_request',
  'csrf_invalid',
  'slug_taken',
  'hash_mismatch',
  'resource_defaults_unsupported',
] as const;

const DECLARED_ERROR_CODES = [
  ...Object.values(ErrorCode),
  ...Object.values(PutSecretError.ErrorEnum),
  ...C12_ERROR_CODES,
  ...Object.values(ConnectErrorCode),
] as const;

/**
 * identity_mismatch is deprecated since contracts 2.2.3 (CC-101): nobody compares the account with the
 * SSO identity any more, so the UI has no state for it and a stray one is treated like any unknown code.
 */
type DeprecatedCode = 'identity_mismatch';

export type PortalErrorCode = Exclude<(typeof DECLARED_ERROR_CODES)[number], DeprecatedCode>;

export const PORTAL_ERROR_CODES: readonly PortalErrorCode[] = DECLARED_ERROR_CODES.filter(
  (code): code is PortalErrorCode => code !== 'identity_mismatch',
);

export type ReturnErrorCode = Exclude<ConnectErrorCode, DeprecatedCode>;

export function isConnectErrorCode(value: unknown): value is ReturnErrorCode {
  return (
    value !== 'identity_mismatch' &&
    (Object.values(ConnectErrorCode) as readonly unknown[]).includes(value)
  );
}

export interface ApiFailure {
  code: PortalErrorCode;
  status: number;
  /** Only for step_up_required; the caller still validates it before navigating. */
  stepUpUrl?: string;
  retryAfterSeconds?: number;
  /** X-Request-Id of the failed response (CC-087), shown shortened next to the error. */
  requestId?: string;
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

/** Only identifier characters pass, so nothing from the response can act as markup or text injection. */
function requestIdOf(body: Record<string, unknown>, error: HttpErrorResponse): string | null {
  const candidate = body['requestId'] ?? error.headers?.get('X-Request-Id');
  return typeof candidate === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(candidate) ? candidate : null;
}

export function toApiFailure(error: unknown): ApiFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { code: 'internal_error', status: -1 };
  }
  const body = readBody(error);
  const bodyCode = body['error'];
  const code = isPortalErrorCode(bodyCode) ? bodyCode : codeFromStatus(error.status);
  const failure: ApiFailure = { code, status: error.status };
  const requestId = requestIdOf(body, error);
  if (requestId) {
    failure.requestId = requestId;
  }
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
