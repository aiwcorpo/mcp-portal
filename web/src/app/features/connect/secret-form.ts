import {
  ChangeDetectionStrategy,
  Component,
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
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CatalogCredential, ConnectionsService, PutSecretResponse } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { errorMessage } from '../../core/error-messages';
import { ErrorNotice } from '../../shared/error-notice';
import { systemName } from '../../shared/labels';
import { Notice } from '../../shared/notice';

export const SECRET_MAX_LENGTH = 4096;
export const USERNAME_MAX_LENGTH = 255;

/**
 * The character set of `PutSecretRequest.username` (CC-222): no ':' (RFC 7617), no control, format or surrogate characters,
 * no line or paragraph separators, no invisible fillers. The broker checks it again; this only saves a round trip.
 */
/* eslint-disable no-misleading-character-class -- the set is the contract's, combining marks included on purpose */
const USERNAME_PATTERN =
  /^[^:\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\ufdd0-\ufdef\ufffe\uffff\u034f\u115f\u1160\u3164\uffa0\u2800\ufe00-\ufe0f]+$/u;
/* eslint-enable no-misleading-character-class */

/** Pasted tokens often carry a trailing newline or space; a token of whitespace only is empty. */
export function nonBlankValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value && !control.value.trim() ? { blank: true } : null;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; result: PutSecretResponse }
  | { kind: 'failed'; failure: ApiFailure };

/**
 * Codes that belong to the token field itself (mockup 05); anything else (503, 429, ...) is not the
 * user's input and shows above the form.
 */
function isFieldFailure(failure: ApiFailure): boolean {
  return failure.code === 'secret_invalid';
}

@Component({
  selector: 'app-secret-form',
  imports: [ReactiveFormsModule, MatButtonModule, RouterLink, DatePipe, Notice, ErrorNotice],
  templateUrl: './secret-form.html',
  styleUrl: './secret-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecretForm {
  private readonly connectionsApi = inject(ConnectionsService);

  readonly system = input.required<string>();
  /** Name of the system as shown on the page (the display name of the broker, CC-248). */
  readonly systemName = input<string>();
  /** `CatalogCredential.userSecretScheme`: with `Basic` the form asks for the login next to the secret (CC-222). */
  readonly scheme = input<CatalogCredential['userSecretScheme']>();
  /** The system does not check tokens, or the connection being renewed was stored without a check: say so before storing. */
  readonly unverified = input(false);
  readonly connected = output<PutSecretResponse>();

  protected readonly maxLength = SECRET_MAX_LENGTH;
  protected readonly usernameMaxLength = USERNAME_MAX_LENGTH;
  protected readonly basic = computed(() => this.scheme() === 'Basic');
  protected readonly phase = signal<Phase>({ kind: 'idle' });
  protected readonly systemLabel = computed(() => this.systemName() ?? systemName(this.system()));
  protected readonly saving = computed(() => this.phase().kind === 'saving');
  protected readonly fieldError = computed(() => {
    const state = this.phase();
    return state.kind === 'failed' && isFieldFailure(state.failure)
      ? errorMessage(state.failure.code)
      : null;
  });
  protected readonly generalFailure = computed(() => {
    const state = this.phase();
    return state.kind === 'failed' && !isFieldFailure(state.failure) ? state.failure : null;
  });

  protected readonly form = new FormGroup({
    secret: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonBlankValidator, Validators.maxLength(SECRET_MAX_LENGTH)],
    }),
    username: new FormControl('', {
      nonNullable: true,
      validators: [
        (control: AbstractControl<string>): ValidationErrors | null => {
          if (!this.basic()) {
            return null;
          }
          const value = control.value.trim();
          if (!value) {
            return { required: true };
          }
          if (value.length > USERNAME_MAX_LENGTH) {
            return { maxlength: true };
          }
          return USERNAME_PATTERN.test(value) ? null : { pattern: true };
        },
      ],
    }),
    expiresAt: new FormControl('', { nonNullable: true }),
  });
  protected readonly hasDate = signal(false);

  constructor() {
    this.form.controls.expiresAt.valueChanges.subscribe((value) => this.hasDate.set(value !== ''));
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
    // The login goes out only for a Basic system; it is neither logged nor shown again after the answer.
    const username = this.basic() ? this.form.controls.username.value.trim() : '';
    const expiresDate = this.form.controls.expiresAt.value;
    // The secret leaves the form before the request completes, whatever the outcome.
    this.form.controls.secret.reset('');
    this.phase.set({ kind: 'saving' });
    try {
      const result = await firstValueFrom(
        this.connectionsApi.putMySecret(this.system(), {
          secret,
          ...(username ? { username } : {}),
          ...(expiresDate ? { expiresAt: `${expiresDate}T00:00:00Z` } : {}),
        }),
      );
      this.form.reset();
      this.phase.set({ kind: 'saved', result });
      this.connected.emit(result);
    } catch (error) {
      this.phase.set({ kind: 'failed', failure: toApiFailure(error) });
    }
  }
}
