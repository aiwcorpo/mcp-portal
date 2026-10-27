import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ConnectionsService, PutSecretResponse, SystemId } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { stepUpUrlFor } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { ErrorNotice } from '../../shared/error-notice';
import { Notice } from '../../shared/notice';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const SECRET_MAX_LENGTH = 4096;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowUtc(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

/** Pasted tokens often carry a trailing newline or space; a token of whitespace only is empty. */
export function nonBlankValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value && !control.value.trim() ? { blank: true } : null;
}

export function futureDateValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value;
  if (!value) {
    return null;
  }
  if (!DATE_ONLY.test(value)) {
    return { date: true };
  }
  return value > todayUtc() ? null : { pastDate: true };
}

export function isDateOnly(value: string | null): value is string {
  return value !== null && DATE_ONLY.test(value);
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; result: PutSecretResponse }
  | { kind: 'stepUp'; url: string }
  | { kind: 'failed'; failure: ApiFailure };

@Component({
  selector: 'app-secret-form',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    DatePipe,
    Notice,
    ErrorNotice,
  ],
  templateUrl: './secret-form.html',
  styleUrl: './secret-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecretForm implements OnInit {
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly navigation = inject(BrowserNavigation);

  readonly system = input.required<SystemId>();
  readonly initialExpiresAt = input<string | null>(null);
  readonly returnedFromStepUp = input(false);
  readonly connected = output<PutSecretResponse>();

  protected readonly maxLength = SECRET_MAX_LENGTH;
  protected readonly minDate = tomorrowUtc();
  protected readonly phase = signal<Phase>({ kind: 'idle' });
  protected readonly saving = computed(() => this.phase().kind === 'saving');

  protected readonly form = new FormGroup({
    secret: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonBlankValidator, Validators.maxLength(SECRET_MAX_LENGTH)],
    }),
    expiresAt: new FormControl('', { nonNullable: true, validators: [futureDateValidator] }),
  });

  ngOnInit(): void {
    const initial = this.initialExpiresAt();
    if (isDateOnly(initial)) {
      this.form.controls.expiresAt.setValue(initial);
    }
  }

  protected async submit(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const secret = this.form.controls.secret.value.trim();
    const expiresDate = this.form.controls.expiresAt.value;
    // The secret leaves the form before the request completes, whatever the outcome.
    this.form.controls.secret.reset('');
    this.phase.set({ kind: 'saving' });
    try {
      const result = await firstValueFrom(
        this.connectionsApi.putMySecret(this.system(), {
          secret,
          ...(expiresDate ? { expiresAt: `${expiresDate}T00:00:00Z` } : {}),
        }),
      );
      this.form.reset();
      this.phase.set({ kind: 'saved', result });
      this.connected.emit(result);
    } catch (error) {
      const failure = toApiFailure(error);
      if (failure.code === 'step_up_required') {
        this.phase.set({
          kind: 'stepUp',
          url: stepUpUrlFor(
            failure.stepUpUrl,
            this.returnPath(expiresDate),
            this.navigation.origin,
          ),
        });
      } else {
        this.phase.set({ kind: 'failed', failure });
      }
    }
  }

  protected reauthenticate(url: string): void {
    this.navigation.assign(url);
  }

  /** Only non-secret fields survive the step-up round trip; the token must be pasted again. */
  private returnPath(expiresDate: string): string {
    const query = expiresDate ? `stepUp=done&expiresAt=${expiresDate}` : 'stepUp=done';
    return `/connect/${this.system()}?${query}`;
  }
}
