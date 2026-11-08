import { HttpErrorResponse } from '@angular/common/http';
import {
  AuthenticatorEnrollmentError,
  ConnectErrorCode,
  ErrorCode,
  PutSecretError,
} from '../api/generated';

/**
 * Codes the UI can explain. C10 and the PUT secret errors come from the generated client; the C12
 * generic Error schema has `error: string`, so its codes from CC-012 and the OAuth callback codes from
 * CC-022 are listed here. Anything else collapses to a status-based code, so no backend text reaches
 * the page.
 */
const C12_ERROR_CODES = [
  'invalid_request',
  'csrf_invalid',
  'hash_mismatch',
  'already_registered',
  'not_requestable',
  'manifest_rejected',
  'server_rejected',
  'scope_mapping_rejected',
  'override_rejected',
  'system_rejected',
  'server_exists',
  'connection_changed',
  'no_pending_connection',
  'refresh_too_frequent',
  'precondition_failed',
  'precondition_required',
] as const;

const DECLARED_ERROR_CODES = [
  ...Object.values(ErrorCode),
  ...Object.values(PutSecretError.ErrorEnum),
  ...Object.values(AuthenticatorEnrollmentError.ErrorEnum),
  ...C12_ERROR_CODES,
  ...Object.values(ConnectErrorCode),
] as const;

export type PortalErrorCode = (typeof DECLARED_ERROR_CODES)[number];

export const PORTAL_ERROR_CODES: readonly PortalErrorCode[] = [...new Set(DECLARED_ERROR_CODES)];

/** Contracts 3.0.0 removed identity_mismatch (CC-101): a stray one is an unknown code like any other. */
export type ReturnErrorCode = ConnectErrorCode;

export function isConnectErrorCode(value: unknown): value is ReturnErrorCode {
  return (Object.values(ConnectErrorCode) as readonly unknown[]).includes(value);
}

export interface ApiFailure {
  code: PortalErrorCode;
  status: number;
  /** Only for step_up_required; the caller still validates it before navigating. */
  stepUpUrl?: string;
  retryAfterSeconds?: number;
  /** X-Request-Id of the failed response (CC-087), shown shortened next to the error. */
  requestId?: string;
  /** Closed-form `reason` of a manifest_rejected (CC-133) or invalid_request (invalid_filter, CC-175) answer; the UI maps it to its own text. */
  reason?: string;
  /** `manifestReason` of a `server_rejected` with the reason `manifest_invalid` (CC-249), closed form like `reason`. */
  manifestReason?: string;
  /**
   * `message` of a 422 of an administrator write (server, scope mapping, override, system): the BFF has already
   * neutralised and shortened it, and the page shows it once more through neutraliseText as a detail under its own text.
   */
  message?: string;
}

/** Codes of the 422 bodies of the administrator writes: each carries a closed `reason` and a free `message`. */
const ADMIN_REJECTION_CODES: ReadonlySet<string> = new Set([
  'server_rejected',
  'scope_mapping_rejected',
  'override_rejected',
  'system_rejected',
]);

/** Codes that carry a closed `reason` (the page maps it to its own text). */
const REJECTION_CODES: ReadonlySet<string> = new Set([
  'manifest_rejected',
  'invalid_request',
  'server_rejected',
  'scope_mapping_rejected',
  'override_rejected',
  'system_rejected',
]);

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
  if (REJECTION_CODES.has(code) && typeof body['reason'] === 'string') {
    if (/^[a-z][a-z0-9_]*$/.test(body['reason'])) {
      failure.reason = body['reason'];
    }
  }
  if (
    code === 'server_rejected' &&
    typeof body['manifestReason'] === 'string' &&
    /^[a-z][a-z0-9_]*$/.test(body['manifestReason'])
  ) {
    failure.manifestReason = body['manifestReason'];
  }
  if (
    ADMIN_REJECTION_CODES.has(code) &&
    typeof body['message'] === 'string' &&
    body['message'].length > 0 &&
    body['message'].length <= 500
  ) {
    failure.message = body['message'];
  }
  if (code === 'rate_limited' || code === 'refresh_too_frequent') {
    const retryAfter = Number(body['retryAfterSeconds'] ?? error.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      failure.retryAfterSeconds = retryAfter;
    }
  }
  return failure;
}
