import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DOCUMENT,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthenticatorService } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { stepUpUrlFor } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { NotificationService } from '../../core/notification.service';
import { SessionService } from '../../core/session.service';
import { ResumeIntentStore } from '../../core/resume-intent';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { StateLine } from '../../shared/state-line';
import { QrCode } from './qr-code';

type Step = 'checking' | 'info' | 'starting' | 'scan' | 'code' | 'done' | 'failed' | 'already';

/** Seed material of a registration in progress. It exists only in this component, only while step 2 is shown. */
interface Seed {
  otpauthUri: string;
  secret: string;
}

const STEPS: readonly { key: 'info' | 'scan' | 'code' | 'done'; label: () => string }[] = [
  { key: 'info', label: () => $localize`:@@enroll.stepInfo:Information` },
  { key: 'scan', label: () => $localize`:@@enroll.stepScan:Scanning` },
  { key: 'code', label: () => $localize`:@@enroll.stepCode:First code` },
  { key: 'done', label: () => $localize`:@@enroll.stepDone:Done` },
];

export const REGISTER_PATH = '/authenticator/register';
/** Marks the return from the IdP after a fresh MFA, so that the registration continues without a second click. */
const MFA_RETURN = 'ok';

/**
 * Registration of the Authenticator (mockups 25-29, CC-093) in four steps: information, QR code and key,
 * first code, done. The seed is shown once: it lives in a signal that is emptied when the step is left, when
 * the registration ends, on expiry, when the component is destroyed and when the page is hidden for the
 * back-forward cache. It never goes to the URL, the title, a notice, storage or the router state.
 */
@Component({
  selector: 'app-authenticator-register-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    RouterLink,
    LoadError,
    Loading,
    StateLine,
    QrCode,
  ],
  templateUrl: './register-page.html',
  styleUrl: './register-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthenticatorRegisterPage implements OnInit {
  private readonly api = inject(AuthenticatorService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly navigation = inject(BrowserNavigation);
  private readonly resume = inject(ResumeIntentStore);
  private readonly session = inject(SessionService);
  private readonly clipboard = inject(Clipboard);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);

  /** Query parameter `mfa` (withComponentInputBinding). */
  readonly mfa = input<string | undefined>();

  protected readonly steps = STEPS;
  protected readonly step = signal<Step>('checking');
  /** The user came back from the identity provider: the first button says "Continue" instead of "Next". */
  protected readonly mfaConfirmed = signal(false);
  protected readonly loadFailure = signal<ApiFailure | null>(null);
  protected readonly seed = signal<Seed | null>(null);
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  protected readonly codeWrong = signal(false);
  protected readonly codeAttempted = signal(false);
  protected readonly busy = signal(false);
  /** The IdP returned from the fresh MFA; the user continues with one more click. */
  /** The key may still be in the clipboard and this page could not clear it. */
  protected readonly clipboardAdvice = signal(false);

  private enrollmentId: string | null = null;
  private readonly expiresAt = signal<number | null>(null);
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;
  private returnedFromMfa = false;
  private keyCopied = false;

  protected readonly code = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^[0-9]{6}$/)],
  });

  protected readonly keyGroups = computed(
    () =>
      this.seed()
        ?.secret.match(/.{1,4}/g)
        ?.join(' ') ?? '',
  );
  protected readonly remaining = computed(() => {
    const end = this.expiresAt();
    return end === null ? 0 : Math.max(0, Math.ceil((end - this.now()) / 1000));
  });
  protected readonly remainingText = computed(() => {
    const total = this.remaining();
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  });
  protected readonly currentIndex = computed(() => {
    const step = this.step();
    return step === 'starting' ? 0 : STEPS.findIndex((candidate) => candidate.key === step);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.wipeClipboard(this.seed()?.secret);
      this.discard();
    });
    effect(() => {
      if (this.expiresAt() !== null && this.remaining() === 0) {
        untracked(() => this.expire());
      }
    });
  }

  /** Inputs are bound after construction, so the `mfa` marker can only be read here. */
  ngOnInit(): void {
    void this.begin();
  }

  /**
   * The browser may keep the page in the back-forward cache, frozen right after `pagehide`. The DOM is brought
   * up to date synchronously here, because a scheduled change detection would not run before the freeze, and
   * again on a restore (`pageshow` with `persisted`).
   */
  @HostListener('window:pagehide')
  protected onPageHide(): void {
    this.leave();
  }

  @HostListener('window:pageshow', ['$event'])
  protected onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) {
      this.leave();
    }
  }

  private leave(): void {
    this.wipeClipboard(this.seed()?.secret);
    this.discard();
    if (this.step() === 'scan' || this.step() === 'code') {
      this.step.set('info');
    }
    this.changeDetector.detectChanges();
  }

  private async begin(): Promise<void> {
    this.returnedFromMfa = this.mfa() === MFA_RETURN;
    if (this.returnedFromMfa) {
      await this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
    }
    try {
      const status = await firstValueFrom(this.api.getMyAuthenticator());
      if (status.state === 'active') {
        this.step.set('already');
        return;
      }
    } catch (error) {
      this.loadFailure.set(toApiFailure(error));
      return;
    }
    this.mfaConfirmed.set(this.returnedFromMfa);
    if (this.returnedFromMfa) {
      this.notifications.success(
        $localize`:@@enroll.mfaDone:Identity confirmed. Continue the registration when you are ready.`,
      );
    }
    this.step.set('info');
    // "Next" was clicked before the MFA: the registration starts now, without a second click.
    if (this.returnedFromMfa && this.resume.take('enroll-authenticator', this.session.username())) {
      void this.start();
    }
  }

  protected retryLoad(): void {
    this.loadFailure.set(null);
    this.step.set('checking');
    void this.begin();
  }

  protected async start(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.step.set('starting');
    try {
      const started = await firstValueFrom(this.api.startMyAuthenticatorEnrollment());
      this.enrollmentId = started.enrollmentId;
      this.seed.set({ otpauthUri: started.otpauthUri, secret: started.secret });
      this.expiresAt.set(Date.parse(started.expiresAt));
      this.now.set(Date.now());
      this.timer ??= setInterval(() => this.now.set(Date.now()), 1000);
      this.mfaConfirmed.set(false);
      this.step.set('scan');
    } catch (error) {
      this.step.set('info');
      this.handleStartFailure(toApiFailure(error));
    } finally {
      this.busy.set(false);
    }
  }

  private handleStartFailure(failure: ApiFailure): void {
    if (failure.code === 'already_registered') {
      this.step.set('already');
    } else if (failure.code === 'step_up_required' && !this.returnedFromMfa) {
      this.resume.save({ kind: 'enroll-authenticator' }, this.session.username());
      this.navigation.assign(
        stepUpUrlFor(
          failure.stepUpUrl,
          `${REGISTER_PATH}?mfa=${MFA_RETURN}`,
          this.navigation.origin,
        ),
      );
    } else {
      this.notifications.failure(failure);
    }
    this.returnedFromMfa = false;
    this.mfaConfirmed.set(false);
  }

  protected toCodeStep(): void {
    this.wipeClipboard(this.seed()?.secret);
    this.seed.set(null);
    this.copyState.set('idle');
    this.codeWrong.set(false);
    this.codeAttempted.set(false);
    this.code.reset('');
    this.step.set('code');
  }

  /** The key is gone after step 2, so going back means a new registration, not a second look at the old key. */
  protected backToInfo(): void {
    this.wipeClipboard(this.seed()?.secret);
    this.discard();
    this.step.set('info');
  }

  protected async cancel(): Promise<void> {
    this.wipeClipboard(this.seed()?.secret);
    this.discard();
    await this.router.navigateByUrl('/connections');
  }

  protected async copyKey(): Promise<void> {
    const secret = this.seed()?.secret;
    const copied = Boolean(secret && this.clipboard.copy(secret));
    this.keyCopied = this.keyCopied || copied;
    this.copyState.set(copied ? 'copied' : 'failed');
  }

  protected async submit(): Promise<void> {
    this.codeAttempted.set(true);
    const enrollmentId = this.enrollmentId;
    if (this.busy() || this.code.invalid || !enrollmentId) {
      return;
    }
    this.busy.set(true);
    this.codeWrong.set(false);
    try {
      await firstValueFrom(
        this.api.confirmMyAuthenticatorEnrollment({ enrollmentId, code: this.code.value }),
      );
      this.discard();
      this.step.set('done');
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'invalid_code') {
        this.codeWrong.set(true);
      } else if (failure.code === 'enrollment_invalid' || failure.code === 'not_found_or_denied') {
        this.discard();
        this.step.set('failed');
      } else {
        this.notifications.failure(failure);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected restart(): void {
    this.step.set('info');
  }

  /**
   * The key was copied to the system clipboard, where it would outlive this page. It is overwritten with an
   * empty text when the clipboard still holds exactly this key; where the browser does not allow reading or
   * writing it, the page says so and asks the user to clear it.
   */
  private wipeClipboard(secret: string | undefined): void {
    if (!this.keyCopied || !secret) {
      return;
    }
    this.keyCopied = false;
    const clipboard = this.document.defaultView?.navigator.clipboard;
    const advise = () => this.clipboardAdvice.set(true);
    if (!clipboard?.readText || !clipboard.writeText) {
      advise();
      return;
    }
    void clipboard
      .readText()
      .then((current) => (current === secret ? clipboard.writeText('') : undefined))
      .catch(advise);
  }

  private expire(): void {
    if (this.step() === 'scan' || this.step() === 'code') {
      this.wipeClipboard(this.seed()?.secret);
      this.discard();
      this.step.set('failed');
    }
  }

  /** Empties everything the registration holds and stops the clock. */
  private discard(): void {
    this.seed.set(null);
    this.enrollmentId = null;
    this.expiresAt.set(null);
    this.copyState.set('idle');
    this.code.reset('');
    this.codeAttempted.set(false);
    this.codeWrong.set(false);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
