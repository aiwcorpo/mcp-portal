import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  InjectionToken,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConfirmationArgument, ConfirmationsService, ConfirmationView } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { NotificationService } from '../../core/notification.service';
import { systemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { StateLine } from '../../shared/state-line';
import { formatResource } from '../../shared/resource';
import { neutraliseText } from '../../shared/untrusted-text';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; view: ConfirmationView }
  | { kind: 'stale' }
  | { kind: 'cancelled' }
  | { kind: 'error'; failure: ApiFailure };

interface ArgumentRow {
  name: string;
  value: string;
  truncated: boolean;
  neutralised: boolean;
}

/** Same order as the gateway uses ("sorted by name"); plain code unit order, not a locale. */
export function sortedArguments(args: readonly ConfirmationArgument[]): ConfirmationArgument[] {
  return [...args].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** How often the preview asks whether the operation is still the pending one (contract: for example every 5 s). */
export const CONFIRM_POLL_MS = new InjectionToken<number>('CONFIRM_POLL_MS', {
  providedIn: 'root',
  factory: () => 5000,
});

/**
 * Read-only preview of a pending DESTRUCTIVE operation (mockups 14, 15; CC-091, CC-098, CC-127, CC-128).
 * The confirmation itself is the code typed in the agent's session; this page only shows what the
 * operation is and can cancel it. It tells the gateway that it was seen (`viewed`) only after it is drawn
 * on a visible page, never during prerender, and it asks again every few seconds because another
 * operation can replace this one.
 */
@Component({
  selector: 'app-confirm-page',
  imports: [MatButtonModule, LoadError, Loading, StateLine],
  templateUrl: './confirm-page.html',
  styleUrl: './confirm-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmPage implements OnInit {
  private readonly api = inject(ConfirmationsService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly pollMs = inject(CONFIRM_POLL_MS);

  readonly id = input.required<string>();

  protected readonly phase = signal<Phase>({ kind: 'loading' });
  /** Server time minus client time, from the Date header: a wrong clock on this machine must not decide expiry. */
  private readonly clockOffset = signal(0);
  protected readonly now = signal(Date.now());
  protected readonly viewedFailed = signal(false);
  protected readonly refreshFailed = signal(false);
  protected readonly busy = signal(false);

  private viewedRecorded = false;
  private viewedInFlight = false;
  private polling: ReturnType<typeof setInterval> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;

  protected readonly view = computed(() => {
    const phase = this.phase();
    return phase.kind === 'ready' ? phase.view : null;
  });
  protected readonly systemLabel = computed(() => {
    const view = this.view();
    return view ? systemName(view.system) : '';
  });
  protected readonly toolText = computed(() => neutraliseText(this.view()?.tool ?? ''));
  protected readonly resourceText = computed(() =>
    neutraliseText(formatResource(this.view()?.resource)),
  );
  protected readonly rows = computed<ArgumentRow[]>(() =>
    sortedArguments(this.view()?.arguments ?? []).map((argument) => {
      const safe = neutraliseText(argument.value);
      return {
        name: neutraliseText(argument.name).text,
        value: safe.text,
        truncated: argument.truncated,
        neutralised: safe.neutralised,
      };
    }),
  );
  protected readonly anyNeutralised = computed(
    () =>
      this.rows().some((row) => row.neutralised) ||
      this.resourceText().neutralised ||
      this.toolText().neutralised,
  );
  protected readonly remaining = computed(() => {
    const view = this.view();
    return view ? Math.max(0, Math.ceil((Date.parse(view.expiresAt) - this.now()) / 1000)) : 0;
  });
  protected readonly remainingText = computed(() => {
    const total = this.remaining();
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });
  /** The 120 s are over: the operation is no longer pending, whatever the last answer said. */
  protected readonly expired = computed(() => this.view() !== null && this.remaining() === 0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.stop());
    effect(() => {
      if (this.view() !== null && !this.viewedRecorded && !this.expired()) {
        untracked(() => afterNextRender(() => void this.markViewed(), { injector: this.injector }));
      }
    });
    effect(() => {
      if (this.expired()) {
        untracked(() => this.stop());
      }
    });
  }

  ngOnInit(): void {
    void this.load();
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.clock = setInterval(() => this.tick(), 1000);
    this.polling = setInterval(() => void this.refresh(), this.pollMs);
  }

  private readonly onVisibility = (): void => {
    if (this.document.visibilityState === 'visible') {
      void this.refresh();
      void this.markViewed();
    }
  };

  private tick(): void {
    this.now.set(Date.now() + this.clockOffset());
  }

  /** The view, with the offset between the server clock and this one taken from the Date header. */
  private async read(): Promise<ConfirmationView> {
    const received = Date.now();
    const response = await firstValueFrom(this.api.getMyConfirmation(this.id(), 'response'));
    const server = Date.parse(response.headers.get('Date') ?? '');
    if (Number.isFinite(server)) {
      this.clockOffset.set(server - received);
    }
    return response.body as ConfirmationView;
  }

  private stop(): void {
    this.document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.polling !== null) {
      clearInterval(this.polling);
      this.polling = null;
    }
    if (this.clock !== null) {
      clearInterval(this.clock);
      this.clock = null;
    }
  }

  protected async load(): Promise<void> {
    this.phase.set({ kind: 'loading' });
    try {
      const view = await this.read();
      this.tick();
      this.phase.set({ kind: 'ready', view });
    } catch (error) {
      const failure = toApiFailure(error);
      this.phase.set(
        failure.code === 'not_found_or_denied' ? { kind: 'stale' } : { kind: 'error', failure },
      );
    }
  }

  /** Polling: a 404 means the call was replaced, executed or expired, so the page must stop offering it. */
  private async refresh(): Promise<void> {
    if (this.phase().kind !== 'ready' || this.document.visibilityState !== 'visible') {
      return;
    }
    try {
      const view = await this.read();
      this.refreshFailed.set(false);
      if (this.phase().kind === 'ready') {
        this.phase.set({ kind: 'ready', view });
      }
    } catch (error) {
      if (toApiFailure(error).code === 'not_found_or_denied') {
        this.toStale();
      } else {
        this.refreshFailed.set(true);
      }
    }
    if (this.phase().kind === 'ready' && !this.viewedRecorded) {
      await this.markViewed();
    }
  }

  private toStale(): void {
    this.phase.set({ kind: 'stale' });
    this.stop();
  }

  private async markViewed(): Promise<void> {
    const doc = this.document as Document & { prerendering?: boolean };
    if (
      this.viewedRecorded ||
      this.viewedInFlight ||
      this.phase().kind !== 'ready' ||
      this.expired() ||
      doc.prerendering ||
      doc.visibilityState !== 'visible'
    ) {
      return;
    }
    this.viewedInFlight = true;
    try {
      await firstValueFrom(this.api.markMyConfirmationViewed(this.id()));
      this.viewedRecorded = true;
      this.viewedFailed.set(false);
    } catch (error) {
      if (toApiFailure(error).code === 'not_found_or_denied') {
        this.toStale();
      } else {
        this.viewedFailed.set(true);
      }
    } finally {
      this.viewedInFlight = false;
    }
  }

  protected async cancel(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.cancelMyConfirmation(this.id()));
      this.phase.set({ kind: 'cancelled' });
      this.stop();
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'not_found_or_denied') {
        this.notifications.error(
          $localize`:@@confirm.cancelNotFound:Could not cancel: the operation may have been completed or expired.`,
          {
            action: {
              label: $localize`:@@confirm.toLogs:Check the activity logs`,
              run: () => void this.router.navigate(['/logs']),
            },
          },
        );
      } else {
        this.notifications.failure(failure);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
