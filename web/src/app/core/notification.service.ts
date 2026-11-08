import {
  ApplicationRef,
  ComponentRef,
  DOCUMENT,
  EnvironmentInjector,
  Injectable,
  OnDestroy,
  createComponent,
  inject,
} from '@angular/core';
import { NotificationHost, NotificationItem } from '../shared/notification-host';
import { requestReference } from '../shared/error-notice';
import { neutraliseText } from '../shared/untrusted-text';
import { ApiFailure } from './api-error';
import { failureMessage } from './error-messages';

/** A success goes away by itself; hovering or focusing it holds the countdown (mockup 44). */
const SUCCESS_VISIBLE_MS = 6000;
/** More than three at once is noise: the oldest one makes room. */
const MAX_VISIBLE = 3;

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface ErrorOptions {
  action?: NotificationAction;
  detail?: string | null;
  requestRef?: string | null;
}

interface Countdown {
  timer: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

/**
 * Results of what the user did (a saved token, a deleted link, a failed call) and the return from an OAuth provider.
 * State that lasts (an expiring token, a missing Authenticator) is not announced here: it stays in the row it belongs to.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private readonly host: ComponentRef<NotificationHost>;
  private items: readonly NotificationItem[] = [];
  private nextId = 1;
  private readonly countdowns = new Map<number, Countdown>();

  constructor() {
    const appRef = inject(ApplicationRef);
    this.host = createComponent(NotificationHost, {
      environmentInjector: inject(EnvironmentInjector),
    });
    this.host.instance.dismiss.subscribe((id) => this.dismiss(id));
    this.host.instance.act.subscribe((id) => this.act(id));
    this.host.instance.hold.subscribe((id) => this.hold(id));
    this.host.instance.release.subscribe((id) => this.release(id));
    appRef.attachView(this.host.hostView);
    inject(DOCUMENT).body.appendChild(this.host.location.nativeElement);
  }

  success(text: string): void {
    this.add({ kind: 'success', text, detail: null, requestRef: null, action: null });
  }

  error(text: string, options: ErrorOptions = {}): void {
    this.add({
      kind: 'error',
      text,
      detail: options.detail ?? null,
      requestRef: options.requestRef ?? null,
      action: options.action ?? null,
    });
  }

  /**
   * An API failure through its code. The only backend text shown is the `message` of a rejected administrator write,
   * neutralised; `retry` adds the "Try again" action.
   */
  failure(failure: ApiFailure, retry?: () => void): void {
    this.error(failureMessage(failure), {
      detail: failure.message ? neutraliseText(failure.message).text : null,
      requestRef: requestReference(failure),
      action: retry ? { label: $localize`:@@common.retry2:Try again`, run: retry } : undefined,
    });
  }

  ngOnDestroy(): void {
    for (const id of [...this.countdowns.keys()]) {
      this.stop(id);
    }
    this.host.destroy();
  }

  private add(item: Omit<NotificationItem, 'id'>): void {
    const same = this.items.find(
      (shown) =>
        shown.kind === item.kind &&
        shown.text === item.text &&
        shown.detail === item.detail &&
        shown.action?.label === item.action?.label,
    );
    if (same) {
      // The same message is not repeated; the newer action replaces the older one and a success starts over.
      this.items = this.items.map((shown) =>
        shown === same ? { ...same, requestRef: item.requestRef, action: item.action } : shown,
      );
      this.arm(same.id, item.kind);
      this.publish();
      return;
    }
    const id = this.nextId++;
    this.items = [...this.items, { ...item, id }];
    while (this.items.length > MAX_VISIBLE) {
      const [oldest] = this.items;
      this.stop(oldest.id);
      this.items = this.items.slice(1);
    }
    this.arm(id, item.kind);
    this.publish();
  }

  private arm(id: number, kind: NotificationItem['kind']): void {
    this.stop(id);
    if (kind === 'success') {
      this.start(id, SUCCESS_VISIBLE_MS);
    }
  }

  private start(id: number, remaining: number): void {
    this.countdowns.set(id, {
      remaining,
      startedAt: Date.now(),
      timer: setTimeout(() => this.dismiss(id), remaining),
    });
  }

  private stop(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown?.timer) {
      clearTimeout(countdown.timer);
    }
    this.countdowns.delete(id);
  }

  private hold(id: number): void {
    const countdown = this.countdowns.get(id);
    if (!countdown?.timer) {
      return;
    }
    clearTimeout(countdown.timer);
    this.countdowns.set(id, {
      timer: null,
      remaining: Math.max(countdown.remaining - (Date.now() - countdown.startedAt), 0),
      startedAt: 0,
    });
  }

  private release(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown && !countdown.timer) {
      this.start(id, countdown.remaining);
    }
  }

  private act(id: number): void {
    const action = this.items.find((item) => item.id === id)?.action;
    this.dismiss(id);
    action?.run();
  }

  private dismiss(id: number): void {
    this.stop(id);
    this.items = this.items.filter((item) => item.id !== id);
    this.publish();
  }

  private publish(): void {
    this.host.setInput('items', this.items);
  }
}
