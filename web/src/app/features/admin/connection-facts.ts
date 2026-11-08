import { DatePipe } from '@angular/common';
import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TlsMode } from '../../api/generated';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { tlsModeLabel } from './server-connection';

/** What both `ServerConnection` and `PendingConnection` carry about the certificate. */
export interface ConnectionFactsData {
  tlsMode: TlsMode;
  fingerprint: string | null;
  subject: string | null;
  issuer: string | null;
  sans: string[];
  notAfter: string | null;
}

/**
 * The facts about a connection that an administrator weighs before approving it: the mode, the SHA-256 fingerprint
 * (copyable, to compare with what the server's operator reports), the names in the certificate and its validity. Every
 * text comes from a certificate that a server chose, so it is shown as inert text.
 */
@Component({
  selector: 'app-connection-facts',
  imports: [DatePipe, MatButtonModule, SafeTextPipe],
  templateUrl: './connection-facts.html',
  styleUrl: './connection-facts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionFacts {
  private readonly clipboard = inject(Clipboard);

  readonly facts = input.required<ConnectionFactsData>();
  /** Whether the certificate validates as `ca` for the host; only a pending connection knows. */
  readonly validatesAsCa = input<boolean | null>(null);
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  protected readonly modeLabel = tlsModeLabel;
  protected readonly copyLabel = $localize`:@@connectionFacts.copyLabel:Copy the fingerprint`;

  protected copyFingerprint(): void {
    const fingerprint = this.facts().fingerprint;
    this.copyState.set(fingerprint && this.clipboard.copy(fingerprint) ? 'copied' : 'failed');
  }
}
