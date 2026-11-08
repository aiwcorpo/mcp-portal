import { PendingConnection, ServerConfig, ServerStatus, TlsMode } from '../../api/generated';

export type TagTone = 'danger' | 'warn' | 'ok' | 'neutral';

export interface ServerTag {
  key: 'plain' | 'pinned' | 'certificate_changed';
  label: string;
  tone: TagTone;
}

export function tlsModeLabel(mode: TlsMode): string {
  switch (mode) {
    case 'ca':
      return $localize`:@@serverConnection.modeCa:Trusted CA (chain and host name)`;
    case 'pinned':
      return $localize`:@@serverConnection.modePinned:Pinned certificate`;
    case 'plain':
      return $localize`:@@serverConnection.modePlain:Plain HTTP, no encryption`;
  }
}

export function statusLabel(status: ServerStatus): string {
  switch (status) {
    case 'pending_approval':
      return $localize`:@@serverConnection.statusPending:Pending approval`;
    case 'connected':
      return $localize`:@@serverConnection.statusConnected:Connected`;
    case 'unreachable':
      return $localize`:@@serverConnection.statusUnreachable:Unreachable`;
    case 'certificate_changed':
      return $localize`:@@serverConnection.statusCertificateChanged:Certificate changed`;
    case 'manifest_invalid':
      return $localize`:@@serverConnection.statusManifestInvalid:Manifest invalid`;
  }
}

export function statusTone(status: ServerStatus): TagTone {
  switch (status) {
    case 'connected':
      return 'ok';
    case 'pending_approval':
    case 'manifest_invalid':
      return 'warn';
    case 'unreachable':
    case 'certificate_changed':
      return 'danger';
  }
}

/**
 * The server talks plain HTTP: by the approved connection, or, while nothing is approved, by the one the gateway
 * proposed for the address.
 */
export function usesPlainHttp(
  server: Pick<ServerConfig, 'connection' | 'pendingConnection'>,
): boolean {
  const mode = server.connection?.tlsMode ?? server.pendingConnection?.tlsMode;
  return mode === 'plain';
}

/** Badges next to the status: the warning for plain HTTP, the pinned certificate and a certificate that changed. */
export function serverTags(server: ServerConfig): ServerTag[] {
  const tags: ServerTag[] = [];
  if (usesPlainHttp(server)) {
    tags.push({
      key: 'plain',
      label: $localize`:@@serverConnection.tagPlain:Plain HTTP`,
      tone: 'danger',
    });
  }
  if (server.connection?.tlsMode === 'pinned') {
    tags.push({
      key: 'pinned',
      label: $localize`:@@serverConnection.tagPinned:Pinned certificate`,
      tone: 'neutral',
    });
  }
  if (server.status === 'certificate_changed') {
    tags.push({
      key: 'certificate_changed',
      label: $localize`:@@serverConnection.tagChanged:Certificate changed`,
      tone: 'danger',
    });
  }
  return tags;
}

/** Why the gateway wants the connection approved, in the administrator's terms. */
export function pendingReasonText(reason: PendingConnection['reason']): string {
  switch (reason) {
    case 'first_connection':
      return $localize`:@@serverConnection.reasonFirst:First connection to this server.`;
    case 'certificate_changed':
      return $localize`:@@serverConnection.reasonChanged:The server presents another certificate than the approved one. Calls are refused until you approve the new one.`;
    case 'ca_validation_failed':
      return $localize`:@@serverConnection.reasonCa:The certificate no longer validates for this host as a trusted CA certificate.`;
  }
}

/** `lastError` is a closed code of the gateway; one the portal does not know is shown as it is. */
export function lastErrorText(code: string): string {
  switch (code) {
    case 'tls_handshake_failed':
      return $localize`:@@serverConnection.errHandshake:TLS handshake failed.`;
    case 'certificate_changed':
      return $localize`:@@serverConnection.errCertificate:The server presents another certificate than the approved one.`;
    case 'manifest_unreachable':
      return $localize`:@@serverConnection.errManifestUnreachable:The manifest could not be read.`;
    case 'manifest_invalid':
      return $localize`:@@serverConnection.errManifestInvalid:The manifest failed the checks of the gateway; the registry keeps the previous one.`;
    case 'address_refused':
      return $localize`:@@serverConnection.errAddress:The address resolves to a refused range.`;
    default:
      return code;
  }
}

export const PLAIN_HTTP_RISK = (): string =>
  $localize`:@@serverConnection.plainWarning:Plain HTTP sends users' credentials unencrypted. Use it only for a server in the same Docker network as the gateway.`;
