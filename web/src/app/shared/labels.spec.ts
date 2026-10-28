import { connectionFixture } from '../../testing/fixtures';
import { actionLabel, catalogStatusText, daysText, daysUntil } from './labels';

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
    expect(daysText(0)).toBe('dziś');
    expect(daysText(1)).toBe('za 1 dzień');
    expect(daysText(5)).toBe('za 5 dni');
  });
});

describe('catalogStatusText', () => {
  it('says when a token expires, as in mockup 01', () => {
    const connection = connectionFixture('jira', {
      type: 'user-secret',
      status: 'expiring',
      expiresAt: '2026-11-02T10:00:00Z',
    });
    expect(catalogStatusText('expiring', connection, NOW)).toBe('Token wygasa za 5 dni');
    expect(catalogStatusText('expiring', { ...connection, type: 'user-oauth' }, NOW)).toBe(
      'Połączenie wygasa za 5 dni',
    );
  });

  it('falls back to the plain label without a date and for other statuses', () => {
    expect(catalogStatusText('expiring', null, NOW)).toBe('Wkrótce wygasa');
    expect(catalogStatusText('connected', null, NOW)).toBe('Połączone');
    expect(catalogStatusText('reconnect_required', null, NOW)).toBe('Wymaga ponownego połączenia');
    expect(catalogStatusText('not_connected', null, NOW)).toBe('Niepołączone');
    expect(catalogStatusText('request_pending', null, NOW)).toBe('Wniosek oczekuje');
    expect(catalogStatusText('no_access', null, NOW)).toBe('Brak uprawnienia');
  });
});

describe('actionLabel', () => {
  it('names the way to renew by what exists', () => {
    expect(actionLabel('reconnect', connectionFixture('jira', { type: 'user-oauth' }))).toBe(
      'Połącz',
    );
    expect(actionLabel('reconnect', connectionFixture('jira', { type: 'user-secret' }))).toBe(
      'Odnów',
    );
    expect(actionLabel('add_secret', connectionFixture('jira', { type: 'user-secret' }))).toBe(
      'Odnów',
    );
    expect(actionLabel('add_secret', null)).toBe('Dodaj token');
    expect(actionLabel('disconnect')).toBe('Rozłącz');
  });
});
