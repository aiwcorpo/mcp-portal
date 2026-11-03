import connectedAllGranted from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-all-granted.json';
import connectedDeniedToolRequestPending from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-denied-tool-request-pending.json';
import connectedDeniedToolUnknownEntitlements from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-denied-tool-unknown-entitlements.json';
import connectedServiceAccountDeniedTool from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-service-account-denied-tool.json';
import expiringSecretDeniedTool from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/expiring-secret-denied-tool.json';
import noAccessUnknownEntitlements from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/no-access-unknown-entitlements.json';
import notConnectedDeniedTool from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/not-connected-denied-tool.json';
import reconnectRequiredOauthDeniedTool from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/reconnect-required-oauth-denied-tool.json';
import connectedMixedTypesSecretConnection from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-mixed-types-secret-connection.json';
import connectedOauthDeniedTool from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-oauth-denied-tool.json';
import connectedServiceAccount from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/connected-service-account.json';
import expiringOauth from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/expiring-oauth.json';
import expiringSecret from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/expiring-secret.json';
import noAccess from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/no-access.json';
import notConnectedBoth from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/not-connected-both.json';
import notConnectedOauthOnly from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/not-connected-oauth-only.json';
import reconnectRequiredOauth from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/reconnect-required-oauth.json';
import reconnectRequiredSecret from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/reconnect-required-secret.json';
import requestPending from '@aiwcorpo/mcp-contracts/test-vectors/catalog-actions/request-pending.json';
import type { CatalogAction, CatalogStatus, CredentialType } from '../app/api/generated';
import { connectionFixture, serverFixture, toolFixture } from '../testing/fixtures';
import { MockStore, completeMockOAuth, deriveRow } from './portal-mock';

interface Vector {
  description: string;
  input: {
    status: CatalogStatus;
    supportedTypes: CredentialType[];
    connectionType: CredentialType | null;
    someToolDenied: boolean;
    hasConnection: boolean;
    /** CC-113: false when the catalog names no requiredEntitlements. */
    entitlementsKnown?: boolean;
    pendingRequestForDeniedTool?: boolean;
  };
  expected: { actions: CatalogAction[] };
}

const VECTORS: Record<string, Vector> = {
  'connected-all-granted.json': connectedAllGranted as Vector,
  'connected-denied-tool-request-pending.json': connectedDeniedToolRequestPending as Vector,
  'connected-denied-tool-unknown-entitlements.json':
    connectedDeniedToolUnknownEntitlements as Vector,
  'connected-service-account-denied-tool.json': connectedServiceAccountDeniedTool as Vector,
  'expiring-secret-denied-tool.json': expiringSecretDeniedTool as Vector,
  'no-access-unknown-entitlements.json': noAccessUnknownEntitlements as Vector,
  'not-connected-denied-tool.json': notConnectedDeniedTool as Vector,
  'reconnect-required-oauth-denied-tool.json': reconnectRequiredOauthDeniedTool as Vector,
  'connected-mixed-types-secret-connection.json': connectedMixedTypesSecretConnection as Vector,
  'connected-oauth-denied-tool.json': connectedOauthDeniedTool as Vector,
  'connected-service-account.json': connectedServiceAccount as Vector,
  'expiring-oauth.json': expiringOauth as Vector,
  'expiring-secret.json': expiringSecret as Vector,
  'no-access.json': noAccess as Vector,
  'not-connected-both.json': notConnectedBoth as Vector,
  'not-connected-oauth-only.json': notConnectedOauthOnly as Vector,
  'reconnect-required-oauth.json': reconnectRequiredOauth as Vector,
  'reconnect-required-secret.json': reconnectRequiredSecret as Vector,
  'request-pending.json': requestPending as Vector,
};

/**
 * The status/action table of the contract (CC-083) as the mock applies it, checked against the contract's
 * own vectors, so that the dev mock cannot drift from what the BFF will return.
 */
describe('mock catalog rows follow the contract vectors', () => {
  it.each(Object.keys(VECTORS))('%s', (file) => {
    const { input, expected } = VECTORS[file];
    const granted = input.status !== 'no_access' && input.status !== 'request_pending';
    const requiredEntitlements = input.entitlementsKnown === false ? [] : ['mcp-test-read'];
    const tools = [
      toolFixture('x__granted', { access: granted ? 'granted' : 'denied', requiredEntitlements }),
      ...(input.someToolDenied && granted
        ? [toolFixture('x__denied', { access: 'denied', requiredEntitlements })]
        : []),
    ];
    const credentialStatus =
      input.status === 'expiring'
        ? 'expiring'
        : input.status === 'reconnect_required'
          ? 'revoked'
          : 'connected';
    const connection =
      input.hasConnection && input.connectionType
        ? connectionFixture('jira', { type: input.connectionType, status: credentialStatus })
        : null;
    const server = serverFixture('jira', {
      credential: {
        supportedTypes: input.supportedTypes,
        defaultType: input.supportedTypes[0],
      },
      tools,
    });

    const pending = new Set(
      input.status === 'request_pending' || input.pendingRequestForDeniedTool
        ? requiredEntitlements
        : [],
    );
    const row = deriveRow(server, connection, pending);

    expect(row.status).toBe(input.status);
    expect([...row.actions].sort()).toEqual([...expected.actions].sort());
  });
});

describe('completeMockOAuth', () => {
  it('sends an unknown flow to the root like the BFF does (C12 oauthCallback)', () => {
    expect(completeMockOAuth(new MockStore())).toBe('/?connectError=flow_invalid');
  });
});

describe('a connection in the error state (secret_missing, CC-205)', () => {
  it.each([
    ['user-secret', 'add_secret'],
    ['user-oauth', 'reconnect'],
  ] as const)(
    'is reconnect_required with the renewing action of a %s connection',
    (type, renew) => {
      const server = serverFixture('jira', { tools: [toolFixture('jira__get')] });
      const connection = connectionFixture('jira', { type, status: 'error' });

      const row = deriveRow(server, connection, new Set());

      expect(row.status).toBe('reconnect_required');
      expect([...row.actions].sort()).toEqual([renew, 'disconnect'].sort());
    },
  );
});
