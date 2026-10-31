import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * What the user asked for just before the browser left for the fresh MFA (step_up_required). After the return the
 * portal carries it out once, so the user does not click the same button twice (U12). The parameters are
 * identifiers only: never a token, a key or a password, which is why a form with a secret is not resumable.
 */
export type ResumeIntent =
  | {
      kind: 'approve-tool';
      serverId: string;
      tool: string;
      hash: string;
      acceptRiskLowering: boolean;
    }
  | { kind: 'enroll-authenticator' }
  | { kind: 'remove-authenticator'; registeredAt: string };

export type ResumeKind = ResumeIntent['kind'];
export type ResumeOf<K extends ResumeKind> = Extract<ResumeIntent, { kind: K }>;

const STORAGE_KEY = 'mcp-portal-resume';
/** Long enough for an IdP round trip with a second factor, short enough that an old click does not come back. */
export const RESUME_TTL_MS = 5 * 60_000;

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const TIMESTAMP = /^[0-9TZ:.+-]{1,40}$/;
const HASH = /^[A-Za-z0-9+/=_:-]{1,200}$/;

interface Stored {
  /** `username` of the session that clicked; another user in the same tab gets nothing. */
  user: string;
  intent: ResumeIntent;
  expiresAt: number;
}

function valid(intent: unknown): intent is ResumeIntent {
  if (intent === null || typeof intent !== 'object') {
    return false;
  }
  const candidate = intent as Record<string, unknown>;
  switch (candidate['kind']) {
    case 'enroll-authenticator':
      return true;
    case 'remove-authenticator':
      return (
        typeof candidate['registeredAt'] === 'string' && TIMESTAMP.test(candidate['registeredAt'])
      );
    case 'approve-tool':
      return (
        typeof candidate['serverId'] === 'string' &&
        IDENTIFIER.test(candidate['serverId']) &&
        typeof candidate['tool'] === 'string' &&
        IDENTIFIER.test(candidate['tool']) &&
        typeof candidate['hash'] === 'string' &&
        HASH.test(candidate['hash']) &&
        typeof candidate['acceptRiskLowering'] === 'boolean'
      );
    default:
      return false;
  }
}

/**
 * One slot in sessionStorage of this tab. Only the portal's own click writes it, right before the redirect, so a
 * link with `?mfa=ok` that somebody else sends does nothing: without the slot the page behaves as before and waits
 * for the click. A browser without storage does the same.
 */
@Injectable({ providedIn: 'root' })
export class ResumeIntentStore {
  private readonly storage = this.resolveStorage();

  save(intent: ResumeIntent, user: string, now: number = Date.now()): void {
    if (!user) {
      return;
    }
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ user, intent, expiresAt: now + RESUME_TTL_MS } satisfies Stored),
      );
    } catch {
      // Storage full or blocked: the user clicks again after the return.
    }
  }

  /**
   * Reads and removes the slot; an intent of another kind or of another user, an expired or a damaged one is
   * dropped. The slot is also cleared on logout, on a login error and when the session expires.
   */
  take<K extends ResumeKind>(kind: K, user: string, now: number = Date.now()): ResumeOf<K> | null {
    let raw: string | null;
    try {
      raw = this.storage?.getItem(STORAGE_KEY) ?? null;
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (raw === null) {
      return null;
    }
    try {
      const stored = JSON.parse(raw) as Partial<Stored>;
      if (
        typeof stored.expiresAt === 'number' &&
        user !== '' &&
        stored.user === user &&
        stored.expiresAt >= now &&
        valid(stored.intent) &&
        stored.intent.kind === kind
      ) {
        return stored.intent as ResumeOf<K>;
      }
    } catch {
      // Damaged slot: treated as empty.
    }
    return null;
  }

  clear(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  private resolveStorage(): Storage | null {
    try {
      return inject(DOCUMENT).defaultView?.sessionStorage ?? null;
    } catch {
      return null;
    }
  }
}
