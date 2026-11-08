import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { StateIcon } from './state-icon';

export interface NotificationItem {
  readonly id: number;
  readonly kind: 'success' | 'error';
  readonly text: string;
  readonly detail: string | null;
  readonly requestRef: string | null;
  readonly action: { readonly label: string; readonly run: () => void } | null;
}

/**
 * Corner stack of the notifications (mockups 40, 41, 44). It is created by NotificationService and attached to
 * the body, so it sits above dialogs and exists on every screen. Nothing here takes focus.
 */
@Component({
  selector: 'app-notification-host',
  imports: [StateIcon],
  template: `
    @for (item of items(); track item.id) {
      <div
        class="toast"
        [class.error]="item.kind === 'error'"
        [attr.role]="item.kind === 'error' ? 'alert' : 'status'"
        (mouseenter)="hold.emit(item.id)"
        (mouseleave)="release.emit(item.id)"
        (focusin)="hold.emit(item.id)"
        (focusout)="release.emit(item.id)"
      >
        <span class="icon"><app-state-icon [kind]="item.kind" /></span>
        <div class="body">
          <p class="text">{{ item.text }}</p>
          @if (item.detail) {
            <p class="detail">{{ item.detail }}</p>
          }
          @if (item.requestRef) {
            <p class="request-ref">
              <ng-container i18n="@@common.requestRef3">Reference for support:</ng-container>
              <code>{{ item.requestRef }}</code>
            </p>
          }
          @if (item.action; as action) {
            <button type="button" class="action" (click)="act.emit(item.id)">
              {{ action.label }}
            </button>
          }
        </div>
        <button
          type="button"
          class="close"
          i18n-aria-label="@@notice.close"
          aria-label="Close message"
          (click)="dismiss.emit(item.id)"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      </div>
    }
  `,
  styleUrl: './notification-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationHost {
  readonly items = input<readonly NotificationItem[]>([]);
  readonly dismiss = output<number>();
  readonly act = output<number>();
  readonly hold = output<number>();
  readonly release = output<number>();

  constructor() {
    // The stack lies over the bottom of the page, so the page gets that much room below its content and the
    // last row, with its buttons, can be scrolled clear of a notification.
    const root = inject(DOCUMENT).documentElement;
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      const height = host.offsetHeight;
      root.style.setProperty('--pm-toast-space', height > 0 ? `${height + 48}px` : '0px');
    });
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      root.style.removeProperty('--pm-toast-space');
    });
  }
}
