import { connectionFixture } from '../../testing/fixtures';
import {
  actionLabel,
  catalogStatusText,
  connectionStatusLabel,
  daysText,
  daysUntil,
  isSystemId,
  systemName,
} from './labels';

const NOW = Date.parse('2026-10-28T10:00:00Z');

describe('daysUntil', () => {
  it('counts started days, never negative, null without a date', () => {
    expect(daysUntil('2026-11-02T10:00:00Z', NOW)).toBe(5);
    expect(daysUntil('2026-10-28T12:00:00Z', NOW)).toBe(1);
    expect(daysUntil('2026-10-01T00:00:00Z', NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('not a date', NOW)).toBeNull();
  });
});

describe('daysText', () => {
  it('handles today, one day and many', () => {
    expect(daysText(0)).toBe('today');
    expect(daysText(1)).toBe('in 1 day');
    expect(daysText(5)).toBe('in 5 days');
  });
});

describe('catalogStatusText', () => {
  it('says when a token expires, as in mockup 01', () => {
    const connection = connectionFixture('jira', {
      type: 'user-secret',
      status: 'expiring',
      expiresAt: '2026-11-02T10:00:00Z',
    });
    expect(catalogStatusText('expiring', connection, NOW)).toBe('Token expires in 5 days');
    expect(catalogStatusText('expiring', { ...connection, type: 'user-oauth' }, NOW)).toBe(
      'Connection expires in 5 days',
    );
  });

  it('falls back to the plain label without a date and for other statuses', () => {
    expect(catalogStatusText('expiring', null, NOW)).toBe('Expires soon');
    expect(catalogStatusText('connected', null, NOW)).toBe('Connected');
    expect(catalogStatusText('reconnect_required', null, NOW)).toBe('Needs reconnecting');
    expect(catalogStatusText('not_connected', null, NOW)).toBe('Not connected');
    expect(catalogStatusText('request_pending', null, NOW)).toBe('Request pending');
    expect(catalogStatusText('no_access', null, NOW)).toBe('No entitlement');
  });
});

describe('actionLabel', () => {
  it('names the way to renew by what exists', () => {
    expect(actionLabel('reconnect', connectionFixture('jira', { type: 'user-oauth' }))).toBe(
      'Connect',
    );
    expect(actionLabel('reconnect', connectionFixture('jira', { type: 'user-secret' }))).toBe(
      'Renew',
    );
    expect(actionLabel('add_secret', connectionFixture('jira', { type: 'user-secret' }))).toBe(
      'Renew',
    );
    expect(actionLabel('add_secret', null)).toBe('Add token');
    expect(actionLabel('disconnect')).toBe('Disconnect');
  });
});

describe('systems are runtime data', () => {
  it('names any system by its id, and a server by its system', () => {
    expect(systemName('jira')).toBe('Jira');
    expect(systemName('notes')).toBe('Notes');
    expect(systemName('mcp-notes')).toBe('Notes');
  });

  it('knows a system id by the pattern of the contract, not by a list', () => {
    expect(isSystemId('notes')).toBe(true);
    expect(isSystemId('a1')).toBe(true);
    expect(isSystemId('Notes')).toBe(false);
    expect(isSystemId('n')).toBe(false);
    expect(isSystemId('a'.repeat(32))).toBe(false);
    expect(isSystemId(null)).toBe(false);
  });
});

describe('needs_reconnect', () => {
  it('has its own labels in the catalog row and for the connection', () => {
    const connection = connectionFixture('notes', { status: 'needs_reconnect' });
    expect(catalogStatusText('reconnect_required', connection, NOW)).toBe(
      'The system settings changed, connect the account again',
    );
    expect(connectionStatusLabel('needs_reconnect')).toBe('Connect again');
  });
});
