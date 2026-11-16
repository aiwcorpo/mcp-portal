import { HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AdminService,
  CredentialScheme,
  CredentialType,
  ServiceAccountKeyRequest,
  SystemAdapter,
  SystemAdminRequest,
  SystemAdminView,
  SystemUserSecretScheme,
} from '../../api/generated';
import { AdminStepUp } from '../../core/admin-step-up';
import { NotificationService } from '../../core/notification.service';
import { etagOf } from '../../core/admin-etag';
import { toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { credentialTypeLabel } from '../../shared/labels';
import { SECRET_MAX_LENGTH, USERNAME_MAX_LENGTH, USERNAME_PATTERN } from '../connect/secret-form';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { StateLine } from '../../shared/state-line';
import { SafeTextPipe } from '../../shared/safe-text.pipe';
import { AdminNav } from './admin-nav';
import { AdminSystemNames } from './system-names';
import {
  DISPLAY_NAME,
  DURATION,
  KEY_VALUE,
  OAUTH_SCOPE,
  WHOAMI_FIELD,
  WHOAMI_PATH,
  SYSTEM_ID,
  isHttpsUrl,
  splitList,
} from './admin-validation';

const PAGE = '/admin/systems';
const USER_TYPES: readonly CredentialType[] = ['user-oauth', 'user-secret'];

export interface SystemForm {
  mode: 'create' | 'edit';
  system: string;
  /** Optional; empty means the broker uses the identifier. */
  displayName: string;
  baseUrl: string;
  adapter: SystemAdapter;
  product: '' | 'jira' | 'confluence';
  revokeUrl: string;
  timeout: string;
  /** How a generic-rest system checks a user secret (CC-247); both empty means no check. */
  whoamiPath: string;
  whoamiField: string;
  exchangeAudience: string;
  userSecretScheme: '' | SystemUserSecretScheme;
  supportedTypes: CredentialType[];
  defaultType: CredentialType;
  secretScheme: CredentialScheme;
  clientId: string;
  /** Never part of a draft, never read back: the broker stores it and returns only `clientSecretSet`. */
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
}

/**
 * The form of a service account key (CC-251). Everything secret in it (`value`, `password`) is emptied the moment the
 * form is submitted, whatever the answer is, and none of it is ever put into a draft that waits for the IdP.
 */
export interface KeyForm {
  mode: 'value' | 'pair';
  value: string;
  username: string;
  password: string;
  /** Local date and time as a `datetime-local` field gives it; empty means no planned expiry. */
  expiresAt: string;
}

interface KeyEditing {
  system: string;
  displayName: string;
  /** Only a system in the Basic scheme takes a login and a password (the broker answers `basic_scheme_required`). */
  basic: boolean;
  replacing: boolean;
  form: KeyForm;
}

interface Editing {
  form: SystemForm;
  original: SystemAdminView | null;
  etag: string | null;
}

const EMPTY_FORM: SystemForm = {
  mode: 'create',
  system: '',
  displayName: '',
  baseUrl: '',
  adapter: 'generic-rest',
  product: '',
  revokeUrl: '',
  timeout: '',
  whoamiPath: '',
  whoamiField: '',
  exchangeAudience: '',
  userSecretScheme: '',
  supportedTypes: ['user-secret'],
  defaultType: 'user-secret',
  secretScheme: 'Bearer',
  clientId: '',
  clientSecret: '',
  authorizeUrl: '',
  tokenUrl: '',
  scopes: '',
};

/** Only a generic-rest system that takes user secrets can check them (CC-247). */
export function hasWhoami(form: SystemForm): boolean {
  return (
    form.adapter === 'generic-rest' &&
    form.supportedTypes.includes('user-secret') &&
    (form.whoamiPath.trim() !== '' || form.whoamiField.trim() !== '')
  );
}

/** Whether the system needs an OAuth client of its own: user OAuth and token exchange both do (C4 SystemAdminRequest). */
export function needsOauth(types: readonly CredentialType[]): boolean {
  return types.includes('user-oauth') || types.includes('token-exchange');
}

/**
 * The settings whose change deletes every user connection of the system without calling any endpoint (CC-238), and
 * for which the broker wants the client secret again (`client_secret_required`).
 */
export function changedAddresses(original: SystemAdminView, form: SystemForm): string[] {
  const changed: string[] = [];
  const same = (a: string | undefined, b: string): boolean => (a ?? '') === b.trim();
  if (!same(original.baseUrl, form.baseUrl)) {
    changed.push('baseUrl');
  }
  if (!same(original.revokeUrl, form.revokeUrl)) {
    changed.push('revokeUrl');
  }
  if (!same(original.oauth?.authorizeUrl, form.authorizeUrl)) {
    changed.push('authorizeUrl');
  }
  if (!same(original.oauth?.tokenUrl, form.tokenUrl)) {
    changed.push('tokenUrl');
  }
  if (!same(original.oauth?.clientId, form.clientId)) {
    changed.push('clientId');
  }
  return changed;
}

/** The Systems tab offers the key only where the broker takes one: the system declares the type `service-account`. */
export function takesKey(system: SystemAdminView): boolean {
  return system.supportedTypes.includes('service-account');
}

/** The time of a `datetime-local` field as the UTC timestamp of the contract, or null when it is empty or not a time. */
export function expiryOf(local: string): string | null {
  const time = local.trim() === '' ? NaN : new Date(local).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** UTC with minutes, from a timestamp of the contract: the broker's clock, not the browser's, decides `expired`. */
function utcMinutes(timestamp: string): string {
  return `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)} UTC`;
}

export function keyStatusText(system: SystemAdminView): string {
  const summary = system.serviceAccountKey;
  if (summary?.state === 'missing') {
    return $localize`:@@adminSystems.keyMissing:Service account key: not set. Calls to this system are refused.`;
  }
  if (summary?.state === 'set') {
    if (!summary.expiresAt) {
      return $localize`:@@adminSystems.keySetNoExpiry:Service account key: set, no planned expiry.`;
    }
    const when = utcMinutes(summary.expiresAt);
    return summary.expired
      ? $localize`:@@adminSystems.keyExpired:Service account key: set, expired ${when}:time:. Calls to this system are refused.`
      : $localize`:@@adminSystems.keySetExpires:Service account key: set, expires ${when}:time:.`;
  }
  return $localize`:@@adminSystems.keyUnknown:Service account key: status unknown, the broker could not read its secret store.`;
}

export function keyRequest(form: KeyForm): ServiceAccountKeyRequest {
  const expiresAt = expiryOf(form.expiresAt);
  return {
    ...(form.mode === 'pair'
      ? { username: form.username, password: form.password }
      : { value: form.value }),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function systemRequest(form: SystemForm): SystemAdminRequest {
  const oauth = needsOauth(form.supportedTypes);
  const tokenExchange = form.supportedTypes.includes('token-exchange');
  const scopes = splitList(form.scopes);
  const whoami = hasWhoami(form)
    ? { path: form.whoamiPath.trim(), usernameField: form.whoamiField.trim() }
    : null;
  return {
    baseUrl: form.baseUrl.trim(),
    ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
    adapter: form.adapter,
    supportedTypes: form.supportedTypes,
    defaultType: form.defaultType,
    secretScheme: form.secretScheme,
    ...(form.adapter === 'atlassian-dc' && form.product ? { product: form.product } : {}),
    ...(form.revokeUrl.trim() ? { revokeUrl: form.revokeUrl.trim() } : {}),
    ...(form.timeout.trim() ? { timeout: form.timeout.trim() } : {}),
    ...(whoami ? { whoami } : {}),
    ...(tokenExchange ? { exchangeAudience: form.exchangeAudience.trim() } : {}),
    ...(form.userSecretScheme ? { userSecretScheme: form.userSecretScheme } : {}),
    ...(oauth
      ? {
          oauth: {
            clientId: form.clientId.trim(),
            ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
            ...(form.supportedTypes.includes('user-oauth') && form.authorizeUrl.trim()
              ? { authorizeUrl: form.authorizeUrl.trim() }
              : {}),
            ...(!tokenExchange && form.tokenUrl.trim() ? { tokenUrl: form.tokenUrl.trim() } : {}),
            ...(scopes.length ? { scopes } : {}),
          },
        }
      : {}),
  };
}

/**
 * "Systems" (C12 over C4, CC-235, CC-238): the systems of the credential broker, edited at runtime. The client secret is
 * write only: the list says whether one is stored, and the form asks for it again when an address or the client
 * identifier changes, because that also deletes every user's connection to the system.
 */
@Component({
  selector: 'app-systems-page',
  imports: [FormsModule, MatButtonModule, AdminNav, LoadError, Loading, StateLine, SafeTextPipe],
  templateUrl: './systems-page.html',
  styleUrls: ['./admin-common.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemsPage implements OnInit {
  private readonly adminApi = inject(AdminService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly stepUp = inject(AdminStepUp);
  protected readonly names = inject(AdminSystemNames);

  readonly mfa = input<string | undefined>();

  protected readonly state = signal<LoadState<SystemAdminView[]>>(LOADING);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly touched = signal(false);
  protected readonly keyEditing = signal<KeyEditing | null>(null);
  protected readonly keyTouched = signal(false);
  /** The page was opened by the return from the IdP; a repeated step-up request is then an error, not a loop. */
  private returnedAt = 0;

  protected readonly allTypes: readonly CredentialType[] = [
    'user-oauth',
    'user-secret',
    'token-exchange',
    'service-account',
  ];
  protected readonly adapters: readonly SystemAdapter[] = [
    'atlassian-dc',
    'gitlab',
    'opensearch',
    'generic-rest',
  ];
  protected readonly secretSchemes: readonly CredentialScheme[] = [
    'Bearer',
    'Basic',
    'Token',
    'ApiKey',
  ];
  protected readonly genericTypes: readonly CredentialType[] = ['user-secret', 'service-account'];
  protected readonly userSchemes: readonly SystemUserSecretScheme[] = ['Bearer', 'Basic'];
  protected readonly typeLabel = credentialTypeLabel;

  protected readonly form = computed(() => this.editing()?.form ?? null);
  protected readonly oauth = computed(() => {
    const form = this.form();
    return form ? needsOauth(form.supportedTypes) : false;
  });
  protected readonly changed = computed(() => {
    const current = this.editing();
    return current?.original ? changedAddresses(current.original, current.form) : [];
  });
  /** The secret must be typed (again) when it was never stored here or when an address changed. */
  protected readonly secretRequired = computed(() => {
    const current = this.editing();
    if (!current || !this.oauth()) {
      return false;
    }
    return !current.original?.oauth?.clientSecretSet || this.changed().length > 0;
  });
  protected readonly errors = computed(() => {
    const form = this.form();
    const found: Record<string, string> = {};
    if (!form) {
      return found;
    }
    const url = $localize`:@@adminSystems.errUrl:Enter an https address.`;
    if (form.mode === 'create' && !SYSTEM_ID.test(form.system.trim())) {
      found['system'] =
        $localize`:@@adminSystems.errSystem:Use 2 to 31 lower case letters and digits, starting with a letter. The identifiers gateway, offboarding, portal, broker, prometheus, platform, admin, registry, adapter, internal and ci are reserved.`;
    }
    if (form.displayName.trim() && !DISPLAY_NAME.test(form.displayName.trim())) {
      found['displayName'] =
        $localize`:@@adminSystems.errDisplayName:Use 1 to 64 characters; control and invisible characters are not allowed.`;
    }
    if (!isHttpsUrl(form.baseUrl.trim())) {
      found['baseUrl'] = url;
    }
    if (form.revokeUrl.trim() && !isHttpsUrl(form.revokeUrl.trim())) {
      found['revokeUrl'] = url;
    }
    if (hasWhoami(form)) {
      if (!WHOAMI_PATH.test(form.whoamiPath.trim())) {
        found['whoamiPath'] =
          $localize`:@@adminSystems.errWhoamiPath:Enter a path that starts with a single slash, without a host, a query or "..", for example /api/me.`;
      }
      if (!WHOAMI_FIELD.test(form.whoamiField.trim())) {
        found['whoamiField'] =
          $localize`:@@adminSystems.errWhoamiField:Enter the field of the answer that holds the user name, or a JSON pointer such as /user/login.`;
      }
    }
    if (form.adapter === 'atlassian-dc' && !form.product) {
      found['product'] = $localize`:@@adminSystems.errProduct:Choose Jira or Confluence.`;
    }
    if (form.timeout.trim() && !DURATION.test(form.timeout.trim())) {
      found['timeout'] =
        $localize`:@@adminSystems.errTimeout:Use an ISO 8601 duration of at most 10 minutes, for example PT30S.`;
    }
    if (form.supportedTypes.length === 0) {
      found['supportedTypes'] =
        $localize`:@@adminSystems.errTypes:Choose at least one credential type.`;
    } else if (!form.supportedTypes.includes(form.defaultType)) {
      found['defaultType'] =
        $localize`:@@adminSystems.errDefault:The default type has to be one of the supported types.`;
    } else if (
      form.supportedTypes.includes('service-account') &&
      form.supportedTypes.some((type) => USER_TYPES.includes(type))
    ) {
      found['supportedTypes'] =
        $localize`:@@adminSystems.errMixed:A service account cannot be combined with a user credential type.`;
    }
    if (form.supportedTypes.includes('token-exchange') && !form.exchangeAudience.trim()) {
      found['exchangeAudience'] =
        $localize`:@@adminSystems.errAudience:A token exchange system needs the audience of the token.`;
    }
    if (this.oauth()) {
      if (!form.clientId.trim()) {
        found['clientId'] = $localize`:@@adminSystems.errClientId:Enter the client identifier.`;
      }
      if (this.secretRequired() && !form.clientSecret) {
        found['clientSecret'] = this.changed().length
          ? $localize`:@@adminSystems.errSecretAgain:Enter the client secret again: an address or the client identifier changed.`
          : $localize`:@@adminSystems.errSecret:Enter the client secret.`;
      }
      if (form.supportedTypes.includes('user-oauth') && !isHttpsUrl(form.authorizeUrl.trim())) {
        found['authorizeUrl'] = url;
      }
      if (
        !form.supportedTypes.includes('token-exchange') &&
        form.tokenUrl.trim() &&
        !isHttpsUrl(form.tokenUrl.trim())
      ) {
        found['tokenUrl'] = url;
      }
      if (splitList(form.scopes).some((scope) => !OAUTH_SCOPE.test(scope))) {
        found['scopes'] = $localize`:@@adminSystems.errScopes:A scope cannot contain spaces.`;
      }
    }
    return found;
  });
  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  protected readonly keyForm = computed(() => this.keyEditing()?.form ?? null);
  protected readonly keyErrors = computed(() => {
    const form = this.keyForm();
    const found: Record<string, string> = {};
    if (!form) {
      return found;
    }
    if (form.mode === 'value') {
      if (!KEY_VALUE.test(form.value)) {
        found['value'] =
          $localize`:@@adminSystems.errKeyValue:Enter the key: visible characters only, no spaces, up to 4096.`;
      }
    } else {
      if (!USERNAME_PATTERN.test(form.username) || form.username.length > USERNAME_MAX_LENGTH) {
        found['username'] =
          $localize`:@@adminSystems.errKeyUsername:Enter the login: up to 255 characters, no colon, no control or invisible characters.`;
      }
      if (form.password.length === 0 || form.password.length > SECRET_MAX_LENGTH) {
        found['password'] =
          $localize`:@@adminSystems.errKeyPassword:Enter the password: up to 4096 characters.`;
      }
    }
    if (form.expiresAt.trim() !== '') {
      const expires = expiryOf(form.expiresAt);
      if (expires === null || new Date(expires).getTime() <= Date.now()) {
        found['expiresAt'] =
          $localize`:@@adminSystems.errKeyExpiry:The expiry has to be a date and time in the future.`;
      }
    }
    return found;
  });

  private readonly systemList = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.value : [];
  });

  protected readonly rows = computed(() => {
    const state = this.state();
    return state.status === 'ready'
      ? state.value.map((system) => ({
          system,
          types: system.supportedTypes.map((type) => credentialTypeLabel(type)).join(', '),
          defaultType: credentialTypeLabel(system.defaultType),
          takesKey: takesKey(system),
          keyState: takesKey(system) ? (system.serviceAccountKey?.state ?? 'unknown') : null,
          keyText: takesKey(system) ? keyStatusText(system) : '',
          keyWarn:
            takesKey(system) &&
            !(system.serviceAccountKey?.state === 'set' && !system.serviceAccountKey.expired),
          secret: system.oauth
            ? system.oauth.clientSecretSet
              ? $localize`:@@adminSystems.secretSet:Client secret stored`
              : $localize`:@@adminSystems.secretMissing:No client secret`
            : '',
        }))
      : [];
  });

  /** True for the first write within a minute of the return from the IdP: a step-up request then means the login was no MFA. */
  private takeReturn(): boolean {
    const recent = Date.now() - this.returnedAt < 60_000;
    this.returnedAt = 0;
    return recent;
  }

  ngOnInit(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    await this.load();
    if (this.mfa() === 'ok') {
      this.returnedAt = Date.now();
      const draft = this.stepUp.takeDraft<
        (Omit<SystemForm, 'clientSecret'> & { etag: string | null }) | { keyFor: string }
      >(PAGE);
      void this.router.navigate([], { queryParams: { mfa: null }, replaceUrl: true });
      if (draft && typeof draft === 'object' && 'keyFor' in draft) {
        const target = this.systemList().find((system) => system.system === draft.keyFor);
        if (target && takesKey(target)) {
          this.openKey(target);
        }
        this.notifications.success(
          $localize`:@@adminSystems.mfaKeyDraft:Identity confirmed. Enter the key again and save; it is not kept on the way.`,
        );
      } else if (draft && typeof draft === 'object' && Array.isArray(draft.supportedTypes)) {
        const { etag, ...form } = draft;
        const state = this.state();
        const original =
          form.mode === 'edit' && state.status === 'ready'
            ? (state.value.find((system) => system.system === form.system) ?? null)
            : null;
        this.editing.set({
          form: { ...EMPTY_FORM, ...form, clientSecret: '' },
          original,
          etag: etag ?? null,
        });
        this.notifications.success(
          $localize`:@@adminSystems.mfaDraft:Identity confirmed. Check the form, enter the client secret again and save.`,
        );
      } else {
        this.notifications.success(
          $localize`:@@adminSystems.mfaRepeat:Identity confirmed. Repeat the operation.`,
        );
      }
    }
  }

  protected async load(): Promise<void> {
    this.state.set(LOADING);
    await this.read();
  }

  private async read(): Promise<void> {
    try {
      this.state.set({
        status: 'ready',
        value: await firstValueFrom(this.adminApi.listAdminSystems()),
      });
    } catch (error) {
      this.state.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected openCreate(): void {
    this.closeKey();
    this.reset();
    this.editing.set({
      form: { ...EMPTY_FORM, supportedTypes: [...EMPTY_FORM.supportedTypes] },
      original: null,
      etag: null,
    });
  }

  protected async openEdit(system: SystemAdminView): Promise<void> {
    this.closeKey();
    this.reset();
    this.busy.set(true);
    try {
      const response: HttpResponse<SystemAdminView> = await firstValueFrom(
        this.adminApi.getAdminSystem(system.system, 'response'),
      );
      const current = response.body ?? system;
      this.editing.set({
        form: {
          mode: 'edit',
          system: current.system,
          displayName: current.displayName === current.system ? '' : current.displayName,
          baseUrl: current.baseUrl,
          adapter: current.adapter,
          product: current.product ?? '',
          revokeUrl: current.revokeUrl ?? '',
          timeout: current.timeout ?? '',
          whoamiPath: current.whoami?.path ?? '',
          whoamiField: current.whoami?.usernameField ?? '',
          exchangeAudience: current.exchangeAudience ?? '',
          userSecretScheme: current.userSecretScheme ?? '',
          supportedTypes: [...current.supportedTypes],
          defaultType: current.defaultType,
          secretScheme: current.secretScheme,
          clientId: current.oauth?.clientId ?? '',
          clientSecret: '',
          authorizeUrl: current.oauth?.authorizeUrl ?? '',
          tokenUrl: current.oauth?.tokenUrl ?? '',
          scopes: (current.oauth?.scopes ?? []).join(' '),
        },
        original: current,
        etag: etagOf(response),
      });
    } catch (error) {
      this.notifications.failure(toApiFailure(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected openKey(system: SystemAdminView): void {
    this.editing.set(null);
    this.touched.set(false);
    this.keyTouched.set(false);
    const basic = system.secretScheme === 'Basic';
    this.keyEditing.set({
      system: system.system,
      displayName: system.displayName,
      basic,
      replacing: system.serviceAccountKey?.state === 'set',
      form: {
        mode: basic ? 'pair' : 'value',
        value: '',
        username: '',
        password: '',
        expiresAt: '',
      },
    });
  }

  protected closeKey(): void {
    this.keyEditing.set(null);
    this.keyTouched.set(false);
  }

  protected changeKey(change: Partial<KeyForm>): void {
    this.keyEditing.update((current) =>
      current ? { ...current, form: { ...current.form, ...change } } : current,
    );
  }

  /**
   * Sends the key and empties the secret fields at once, before the answer, so that a failure leaves the date and the
   * choice of form but never the key. A step-up request keeps only the id of the system.
   */
  protected async saveKey(): Promise<void> {
    const returned = this.takeReturn();
    const current = this.keyEditing();
    this.keyTouched.set(true);
    if (!current || Object.keys(this.keyErrors()).length > 0 || this.busy()) {
      return;
    }
    const id = current.system;
    const request = keyRequest(current.form);
    this.changeKey({ value: '', password: '' });
    this.busy.set(true);
    try {
      await firstValueFrom(this.adminApi.putAdminServiceAccountKey(id, request));
      this.notifications.success(
        $localize`:@@adminSystems.keySaved:Saved the service account key of ${id}:system:.`,
      );
      this.closeKey();
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (!this.stepUp.redirectIfRequired(failure, PAGE, { keyFor: id }, returned)) {
        this.notifications.failure(failure);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeKey(system: SystemAdminView): Promise<void> {
    const returned = this.takeReturn();
    if (this.busy()) {
      return;
    }
    const id = system.system;
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@adminSystems.keyRemoveTitle:Delete the service account key of ${id}:system:?`,
            message: $localize`:@@adminSystems.keyRemoveMessage:The broker deletes the key with all its versions. Calls that need the key are refused until a new one is set. Deleting needs a fresh MFA.`,
            confirmLabel: $localize`:@@adminSystems.keyRemoveConfirm:Delete key`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    if (confirmed !== true) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.adminApi.deleteAdminServiceAccountKey(id));
      this.notifications.success(
        $localize`:@@adminSystems.keyRemoved:Deleted the service account key of ${id}:system:.`,
      );
      if (this.keyEditing()?.system === id) {
        this.closeKey();
      }
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (!this.stepUp.redirectIfRequired(failure, PAGE, undefined, returned)) {
        this.notifications.failure(failure);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    this.editing.set(null);
    this.touched.set(false);
  }

  private reset(): void {
    this.touched.set(false);
  }

  protected change(change: Partial<SystemForm>): void {
    this.editing.update((current) =>
      current ? { ...current, form: { ...current.form, ...change } } : current,
    );
  }

  /**
   * A generic-rest system takes user secrets or a service account, never both and never OAuth (CC-247, the broker answers
   * `credential_type_not_supported_by_adapter` otherwise), so the form offers a choice of one and drops the rest.
   */
  protected chooseAdapter(adapter: SystemAdapter): void {
    const form = this.form();
    if (!form) {
      return;
    }
    if (adapter !== 'generic-rest') {
      this.change({ adapter });
      return;
    }
    const type: CredentialType = form.supportedTypes.includes('service-account')
      ? 'service-account'
      : 'user-secret';
    this.change({ adapter, supportedTypes: [type], defaultType: type });
  }

  protected chooseGenericType(type: CredentialType): void {
    this.change({ supportedTypes: [type], defaultType: type });
  }

  protected toggleType(type: CredentialType, on: boolean): void {
    const form = this.form();
    if (!form) {
      return;
    }
    const types = on
      ? [...new Set([...form.supportedTypes, type])]
      : form.supportedTypes.filter((candidate) => candidate !== type);
    this.change({
      supportedTypes: types,
      defaultType: types.includes(form.defaultType)
        ? form.defaultType
        : (types[0] ?? form.defaultType),
    });
  }

  protected async save(): Promise<void> {
    const returned = this.takeReturn();
    const current = this.editing();
    this.touched.set(true);
    if (!current || !this.valid() || this.busy()) {
      return;
    }
    const form = current.form;
    const replacing = form.mode === 'edit';
    if (replacing && !current.etag) {
      this.notifications.failure({ code: 'precondition_required', status: 428 });
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.adminApi.putAdminSystem(
          form.system.trim(),
          systemRequest(form),
          replacing ? (current.etag ?? undefined) : undefined,
          replacing ? undefined : '*',
        ),
      );
      const id = form.system.trim();
      this.notifications.success(
        replacing
          ? this.changed().length
            ? $localize`:@@adminSystems.savedInvalidated:Saved the system ${id}:system:. The connections of its users were deleted; they connect again.`
            : $localize`:@@adminSystems.saved:Saved the system ${id}:system:.`
          : $localize`:@@adminSystems.added:Added the system ${id}:system:.`,
      );
      this.editing.set(null);
      this.touched.set(false);
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      // The secret never goes into the draft that waits in sessionStorage during the trip to the IdP.
      const draft = { ...form, clientSecret: '' };
      if (
        this.stepUp.redirectIfRequired(failure, PAGE, { ...draft, etag: current.etag }, returned)
      ) {
        return;
      }
      this.notifications.failure(failure);
      if (failure.code === 'precondition_failed') {
        await this.read();
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(system: SystemAdminView): Promise<void> {
    const returned = this.takeReturn();
    if (this.busy()) {
      return;
    }
    const id = system.system;
    this.busy.set(true);
    this.reset();
    try {
      const response = await firstValueFrom(this.adminApi.getAdminSystem(id, 'response'));
      const etag = etagOf(response);
      const confirmed = await firstValueFrom(
        this.dialog
          .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
            data: {
              title: $localize`:@@adminSystems.removeTitle:Remove the system ${id}:system:?`,
              message: $localize`:@@adminSystems.removeMessage:The broker deletes the settings, the client secret, the service account key (if one is set) and the connections of all users to this system. Nothing is sent to the system itself. Removing needs a fresh MFA.`,
              confirmLabel: $localize`:@@adminSystems.removeConfirm:Remove system`,
              destructive: true,
            },
          })
          .afterClosed(),
      );
      if (confirmed !== true) {
        return;
      }
      if (!etag) {
        this.notifications.failure({ code: 'precondition_required', status: 428 });
        return;
      }
      await firstValueFrom(this.adminApi.deleteAdminSystem(etag, id));
      this.notifications.success(
        $localize`:@@adminSystems.removed:Removed the system ${id}:system:.`,
      );
      await this.read();
    } catch (error) {
      const failure = toApiFailure(error);
      if (!this.stepUp.redirectIfRequired(failure, PAGE, undefined, returned)) {
        this.notifications.failure(failure);
        if (failure.code === 'precondition_failed') {
          await this.read();
        }
      }
    } finally {
      this.busy.set(false);
    }
  }
}
