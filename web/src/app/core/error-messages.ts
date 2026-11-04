import { ApiFailure, PortalErrorCode } from './api-error';

const MESSAGES: Record<PortalErrorCode, () => string> = {
  unauthenticated: () => $localize`:@@error.unauthenticated:Session expired. Sign in again.`,
  access_denied: () => $localize`:@@error.access_denied:You are not allowed to perform this operation.`,
  tool_disabled: () =>
    $localize`:@@error.tool_disabled:The tool has been switched off by an administrator.`,
  confirmation_required: () =>
    $localize`:@@error.confirmation_required:This operation requires confirmation.`,
  confirmation_failed: () =>
    $localize`:@@error.confirmation_failed:Confirmation failed or expired.`,
  confirmation_superseded: () =>
    $localize`:@@error.confirmation_superseded:The operation was replaced by a newer one.`,
  confirmation_cancelled: () =>
    $localize`:@@error.confirmation_cancelled:The operation was cancelled.`,
  confirmation_blocked: () =>
    $localize`:@@error.confirmation_blocked:Another irreversible operation is waiting for a code.`,
  already_registered: () =>
    $localize`:@@error.already_registered:Authenticator is already registered. Remove it to register again.`,
  invalid_code: () => $localize`:@@error.invalid_code:Invalid code.`,
  enrollment_invalid: () =>
    $localize`:@@error.enrollment_invalid:Registration expired or 3 wrong codes were entered.`,
  credential_required: () =>
    $localize`:@@error.credential_required:Connect your account in this system first.`,
  not_found_or_denied: () =>
    $localize`:@@error.not_found_or_denied:Resource not found or you do not have access to it.`,
  invalid_argument: () => $localize`:@@error.invalid_argument:Invalid input.`,
  rate_limited: () => $localize`:@@error.rate_limited:Too many requests. Try again in a moment.`,
  step_up_required: () =>
    $localize`:@@error.step_up_required:This operation requires re-authentication (MFA).`,
  upstream_unavailable: () =>
    $localize`:@@error.upstream_unavailable:The service is temporarily unavailable.`,
  internal_error: () =>
    $localize`:@@error.internal_error:An unexpected error occurred. Try again later.`,
  invalid_request: () =>
    $localize`:@@error.invalid_request:The request was rejected as invalid.`,
  csrf_invalid: () =>
    $localize`:@@error.csrf_invalid:The form has expired. Refresh the page and try again.`,
  secret_invalid: () => $localize`:@@error.secret_invalid:Token is invalid or expired.`,
  hash_mismatch: () =>
    $localize`:@@error.hash_mismatch:The definition changed in the meantime. Refresh the view.`,
  not_requestable: () =>
    $localize`:@@error.not_requestable:The entitlement system does not accept requests from the portal. Submit the request directly in the entitlement system.`,
  manifest_rejected: () =>
    $localize`:@@error.manifest_rejected:The definition was rejected and cannot be approved.`,
  flow_invalid: () =>
    $localize`:@@error.flow_invalid:The connection link expired or was already used. Start again.`,
  provider_error: () =>
    $localize`:@@error.provider_error:The system did not respond correctly. Try again in a moment.`,
  cancelled: () => $localize`:@@error.cancelled:Connection cancelled.`,
};

export function errorMessage(code: PortalErrorCode): string {
  return MESSAGES[code]();
}

function manifestRejectedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'risk_lowered':
      return $localize`:@@error.risk_lowered:The new definition lowers the tool's risk level, so it will not be approved. Fix the risk in the manifest and redeploy the server.`;
    case 'environment_mismatch':
      return $localize`:@@error.environment_mismatch:The manifest is meant for a different environment and was rejected.`;
    case 'credential_type_mismatch':
      return $localize`:@@error.credential_type_mismatch:The manifest does not match the credential type configured for the system and was rejected.`;
    case 'classification_inconsistent':
      return $localize`:@@error.classification_inconsistent:Risk and action do not match. Read pairs with the read action, write with update or admin, delete with delete or admin.`;
    case 'classification_required':
      return $localize`:@@error.classification_required:This tool comes from an adapter and needs classification: choose a risk and an action.`;
    case 'classification_not_allowed':
      return $localize`:@@error.classification_not_allowed:The gateway does not accept this classification. The adapter is read-only: its tool can only be approved as Read (read), and definitions from other sources are not classified.`;
    case 'adapter_mode_mismatch':
      return $localize`:@@error.adapter_mode_mismatch:The server mode in the gateway does not match the manifest source. Check the adapter configuration.`;
    default:
      return errorMessage('manifest_rejected');
  }
}

export function failureMessage(failure: ApiFailure): string {
  if (failure.code === 'manifest_rejected') {
    return manifestRejectedMessage(failure.reason);
  }
  if (failure.code === 'invalid_request' && failure.reason === 'invalid_filter') {
    return $localize`:@@error.invalid_filter:This filter cannot be saved in the address. Change the selection.`;
  }
  if (failure.code === 'rate_limited' && failure.retryAfterSeconds) {
    return $localize`:@@error.rate_limited_retry:Too many requests. Try again in ${failure.retryAfterSeconds}:seconds: s.`;
  }
  return errorMessage(failure.code);
}
