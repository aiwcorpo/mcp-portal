import { ApiFailure, PortalErrorCode } from './api-error';

const MESSAGES: Record<PortalErrorCode, () => string> = {
  unauthenticated: () => $localize`:@@error.unauthenticated:Sesja wygasła. Zaloguj się ponownie.`,
  access_denied: () => $localize`:@@error.access_denied:Nie masz uprawnień do tej operacji.`,
  tool_disabled: () =>
    $localize`:@@error.tool_disabled:Narzędzie jest wyłączone przez administratora.`,
  confirmation_required: () =>
    $localize`:@@error.confirmation_required:Ta operacja wymaga potwierdzenia.`,
  confirmation_failed: () =>
    $localize`:@@error.confirmation_failed:Potwierdzenie nie powiodło się lub wygasło.`,
  confirmation_declined: () =>
    $localize`:@@error.confirmation_declined:Operacja została odrzucona.`,
  credential_required: () =>
    $localize`:@@error.credential_required:Najpierw połącz konto w tym systemie.`,
  not_found_or_denied: () =>
    $localize`:@@error.not_found_or_denied:Nie znaleziono zasobu albo nie masz do niego dostępu.`,
  invalid_argument: () => $localize`:@@error.invalid_argument:Niepoprawne dane wejściowe.`,
  rate_limited: () => $localize`:@@error.rate_limited:Za dużo żądań. Spróbuj ponownie za chwilę.`,
  step_up_required: () =>
    $localize`:@@error.step_up_required:Ta operacja wymaga ponownego uwierzytelnienia (MFA).`,
  upstream_unavailable: () =>
    $localize`:@@error.upstream_unavailable:Usługa jest chwilowo niedostępna.`,
  internal_error: () =>
    $localize`:@@error.internal_error:Wystąpił nieoczekiwany błąd. Spróbuj ponownie później.`,
  invalid_request: () =>
    $localize`:@@error.invalid_request:Żądanie zostało odrzucone jako niepoprawne.`,
  csrf_invalid: () =>
    $localize`:@@error.csrf_invalid:Formularz stracił ważność. Odśwież stronę i spróbuj ponownie.`,
  secret_invalid: () => $localize`:@@error.secret_invalid:Token nieprawidłowy albo wygasł.`,
  slug_taken: () => $localize`:@@error.slug_taken:Ten identyfikator jest już zajęty. Wybierz inny.`,
  virtual_server_limit_reached: () =>
    $localize`:@@error.virtual_server_limit_reached:Osiągnięto limit linków. Usuń nieużywany link.`,
  resource_defaults_unsupported: () =>
    $localize`:@@error.resource_defaults_unsupported:Zawężanie zasobów nie jest jeszcze dostępne.`,
  hash_mismatch: () =>
    $localize`:@@error.hash_mismatch:Definicja zmieniła się w międzyczasie. Odśwież widok.`,
  flow_invalid: () =>
    $localize`:@@error.flow_invalid:Link połączenia wygasł albo był już użyty. Zacznij od nowa.`,
  provider_error: () =>
    $localize`:@@error.provider_error:System nie odpowiedział poprawnie. Spróbuj za chwilę.`,
  cancelled: () => $localize`:@@error.cancelled:Łączenie anulowane.`,
};

export function errorMessage(code: PortalErrorCode): string {
  return MESSAGES[code]();
}

export function failureMessage(failure: ApiFailure): string {
  if (failure.code === 'rate_limited' && failure.retryAfterSeconds) {
    return $localize`:@@error.rate_limited_retry:Za dużo żądań. Spróbuj ponownie za ${failure.retryAfterSeconds}:seconds: s.`;
  }
  return errorMessage(failure.code);
}
