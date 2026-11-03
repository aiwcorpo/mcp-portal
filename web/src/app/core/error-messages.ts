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
  confirmation_superseded: () =>
    $localize`:@@error.confirmation_superseded:Operacja została zastąpiona nowszą.`,
  confirmation_cancelled: () =>
    $localize`:@@error.confirmation_cancelled:Operacja została anulowana.`,
  confirmation_blocked: () =>
    $localize`:@@error.confirmation_blocked:Inna operacja nieodwracalna czeka na kod.`,
  already_registered: () =>
    $localize`:@@error.already_registered:Authenticator jest już zarejestrowany. Usuń go, żeby zarejestrować od nowa.`,
  invalid_code: () => $localize`:@@error.invalid_code:Kod nieprawidłowy.`,
  enrollment_invalid: () =>
    $localize`:@@error.enrollment_invalid:Rejestracja wygasła albo wpisano 3 błędne kody.`,
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
  hash_mismatch: () =>
    $localize`:@@error.hash_mismatch:Definicja zmieniła się w międzyczasie. Odśwież widok.`,
  not_requestable: () =>
    $localize`:@@error.not_requestable:System uprawnień nie przyjmuje wniosków z portalu. Złóż wniosek bezpośrednio w systemie uprawnień.`,
  manifest_rejected: () =>
    $localize`:@@error.manifest_rejected:Definicja została odrzucona i nie może być zatwierdzona.`,
  flow_invalid: () =>
    $localize`:@@error.flow_invalid:Link połączenia wygasł albo był już użyty. Zacznij od nowa.`,
  provider_error: () =>
    $localize`:@@error.provider_error:System nie odpowiedział poprawnie. Spróbuj za chwilę.`,
  cancelled: () => $localize`:@@error.cancelled:Łączenie anulowane.`,
};

export function errorMessage(code: PortalErrorCode): string {
  return MESSAGES[code]();
}

function manifestRejectedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'risk_lowered':
      return $localize`:@@error.risk_lowered:Nowa definicja obniża poziom ryzyka narzędzia, więc nie zostanie zatwierdzona. Popraw ryzyko w manifeście i wdróż serwer ponownie.`;
    case 'environment_mismatch':
      return $localize`:@@error.environment_mismatch:Manifest jest przeznaczony dla innego środowiska i został odrzucony.`;
    case 'credential_type_mismatch':
      return $localize`:@@error.credential_type_mismatch:Manifest nie zgadza się z typem poświadczenia skonfigurowanym dla systemu i został odrzucony.`;
    case 'classification_inconsistent':
      return $localize`:@@error.classification_inconsistent:Ryzyko i akcja nie pasują do siebie. Odczyt łączy się z akcją read, zapis z update lub admin, usuwanie z delete lub admin.`;
    case 'classification_required':
      return $localize`:@@error.classification_required:To narzędzie pochodzi z adaptera i wymaga klasyfikacji: wybierz ryzyko i akcję.`;
    case 'classification_not_allowed':
      return $localize`:@@error.classification_not_allowed:Klasyfikować można tylko narzędzia z adaptera. Ta definicja pochodzi z innego źródła.`;
    case 'adapter_mode_mismatch':
      return $localize`:@@error.adapter_mode_mismatch:Tryb serwera w gatewayu nie zgadza się ze źródłem manifestu. Sprawdź konfigurację adaptera.`;
    default:
      return errorMessage('manifest_rejected');
  }
}

export function failureMessage(failure: ApiFailure): string {
  if (failure.code === 'manifest_rejected') {
    return manifestRejectedMessage(failure.reason);
  }
  if (failure.code === 'invalid_request' && failure.reason === 'invalid_filter') {
    return $localize`:@@error.invalid_filter:Takiego filtru nie da się zapisać w adresie. Zmień wybór.`;
  }
  if (failure.code === 'rate_limited' && failure.retryAfterSeconds) {
    return $localize`:@@error.rate_limited_retry:Za dużo żądań. Spróbuj ponownie za ${failure.retryAfterSeconds}:seconds: s.`;
  }
  return errorMessage(failure.code);
}
