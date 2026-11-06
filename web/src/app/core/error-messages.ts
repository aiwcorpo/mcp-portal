import { ApiFailure, PortalErrorCode } from './api-error';

const MESSAGES: Record<PortalErrorCode, () => string> = {
  unauthenticated: () => $localize`:@@error.unauthenticated:Session expired. Sign in again.`,
  access_denied: () =>
    $localize`:@@error.access_denied:You are not allowed to perform this operation.`,
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
  invalid_request: () => $localize`:@@error.invalid_request:The request was rejected as invalid.`,
  csrf_invalid: () =>
    $localize`:@@error.csrf_invalid:The form has expired. Refresh the page and try again.`,
  secret_invalid: () => $localize`:@@error.secret_invalid:Token is invalid or expired.`,
  hash_mismatch: () =>
    $localize`:@@error.hash_mismatch:The definition changed in the meantime. Refresh the view.`,
  not_requestable: () =>
    $localize`:@@error.not_requestable:The entitlement system does not accept requests from the portal. Submit the request directly in the entitlement system.`,
  manifest_rejected: () =>
    $localize`:@@error.manifest_rejected:The definition was rejected and cannot be approved.`,
  server_rejected: () =>
    $localize`:@@error.server_rejected:The gateway did not accept the server settings.`,
  scope_mapping_rejected: () =>
    $localize`:@@error.scope_mapping_rejected:The gateway did not accept the scope mapping. Nothing was saved.`,
  override_rejected: () =>
    $localize`:@@error.override_rejected:The gateway did not accept the override.`,
  system_rejected: () =>
    $localize`:@@error.system_rejected:The credential broker did not accept the system settings.`,
  server_exists: () =>
    $localize`:@@error.server_exists:A server with this identifier already exists.`,
  precondition_failed: () =>
    $localize`:@@error.precondition_failed:Someone changed this in the meantime. Reload the data and make your change again.`,
  precondition_required: () =>
    $localize`:@@error.precondition_required:The data has to be loaded before it can be changed. Reload the page.`,
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

function serverRejectedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'server_id_mismatch':
      return $localize`:@@error.server_id_mismatch:The server identifier must be mcp- followed by the system identifier.`;
    case 'system_reserved':
      return $localize`:@@error.system_reserved:This system identifier is reserved for a component of the platform.`;
    case 'credential_types_mixed':
      return $localize`:@@error.credential_types_mixed:A service account cannot be combined with a user credential type.`;
    case 'credential_type_not_accepted':
      return $localize`:@@error.credential_type_not_accepted:The credential type in use has to be one of the accepted types.`;
    default:
      return errorMessage('server_rejected');
  }
}

function scopeMappingRejectedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'unknown_resource_type':
      return $localize`:@@error.unknown_resource_type:No registered server declares the resource type of one of the scopes. Nothing was saved.`;
    case 'scope_not_grantable':
      return $localize`:@@error.scope_not_grantable:The server declares no scope pattern for the type of one of the scopes, so it cannot be granted. Nothing was saved.`;
    case 'scope_invalid':
      return $localize`:@@error.scope_invalid:The part after the slash does not match the scope pattern of its type. Nothing was saved.`;
    case 'group_duplicate':
      return $localize`:@@error.group_duplicate:A group appears twice. Nothing was saved.`;
    default:
      return errorMessage('scope_mapping_rejected');
  }
}

function overrideRejectedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'not_forbid':
      return $localize`:@@error.not_forbid:An override can only forbid. Use a forbid policy.`;
    case 'not_one_policy':
      return $localize`:@@error.not_one_policy:The text has to hold exactly one policy.`;
    case 'id_invalid':
      return $localize`:@@error.id_invalid:The identifier has to look like override- followed by a name.`;
    case 'target_mismatch':
      return $localize`:@@error.target_mismatch:The policy does not fit the target: for the gateway it has to decide the call action on a tool, for a server it must not mention the tool or the call action.`;
    case 'invalid_policy':
      return $localize`:@@error.invalid_policy:The policy does not parse or does not validate against the schema of its target.`;
    case 'id_mismatch':
      return $localize`:@@error.id_mismatch:The @id annotation in the text has to equal the identifier of the override.`;
    case 'target_unknown':
      return $localize`:@@error.target_unknown:There is no server with this identifier in the registry.`;
    default:
      return errorMessage('override_rejected');
  }
}

function systemRejectedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'client_secret_required':
      return $localize`:@@error.client_secret_required:The client secret has to be entered again when the base address, the authorization or token address or the client identifier changes.`;
    case 'token_url_not_settable':
      return $localize`:@@error.token_url_not_settable:A token exchange system takes no token address: the broker uses the one of its identity provider.`;
    case 'product_required':
      return $localize`:@@error.product_required:This adapter needs the product (Jira or Confluence).`;
    case 'exchange_audience_required':
      return $localize`:@@error.exchange_audience_required:A token exchange system needs the audience of the token.`;
    case 'system_reserved':
      return $localize`:@@error.system_reserved_system:This system identifier is reserved for a component of the platform.`;
    case 'default_type_not_supported':
      return $localize`:@@error.default_type_not_supported:The default credential type has to be one of the supported types.`;
    case 'credential_types_mixed':
      return $localize`:@@error.credential_types_mixed_system:A service account cannot be combined with a user credential type.`;
    case 'oauth_required':
      return $localize`:@@error.oauth_required:OAuth needs the client settings: identifier, secret and the authorization and token addresses.`;
    default:
      return errorMessage('system_rejected');
  }
}

export function failureMessage(failure: ApiFailure): string {
  if (failure.code === 'server_rejected') {
    return serverRejectedMessage(failure.reason);
  }
  if (failure.code === 'scope_mapping_rejected') {
    return scopeMappingRejectedMessage(failure.reason);
  }
  if (failure.code === 'override_rejected') {
    return overrideRejectedMessage(failure.reason);
  }
  if (failure.code === 'system_rejected') {
    return systemRejectedMessage(failure.reason);
  }
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
