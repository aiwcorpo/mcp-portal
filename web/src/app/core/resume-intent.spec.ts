import { TestBed } from '@angular/core/testing';
import { DRAFT_MAX, RESUME_TTL_MS, ResumeIntentStore } from './resume-intent';

describe('ResumeIntentStore admin drafts', () => {
  let store: ResumeIntentStore;

  beforeEach(() => {
    sessionStorage.clear();
    store = TestBed.inject(ResumeIntentStore);
  });

  it('gives a draft of an administration page back once, to the user who saved it', () => {
    store.save(
      { kind: 'admin-draft', page: '/admin/servers', draft: '{"system":"notes"}' },
      'anna',
    );

    expect(store.take('admin-draft', 'jan')).toBeNull();
    store.save(
      { kind: 'admin-draft', page: '/admin/servers', draft: '{"system":"notes"}' },
      'anna',
    );
    expect(store.take('admin-draft', 'anna')?.draft).toBe('{"system":"notes"}');
    expect(store.take('admin-draft', 'anna')).toBeNull();
  });

  it('takes whatever is kept with takeAny, and drops what is old, foreign or malformed', () => {
    const now = Date.now();
    store.save({ kind: 'admin-draft', page: '/admin', draft: '{}' }, 'anna', now);
    expect(store.takeAny('anna', now)?.kind).toBe('admin-draft');

    store.save({ kind: 'admin-draft', page: '/admin', draft: '{}' }, 'anna', now);
    expect(store.takeAny('anna', now + RESUME_TTL_MS + 1)).toBeNull();

    store.save({ kind: 'admin-draft', page: '/api/v1/x', draft: '{}' }, 'anna', now);
    expect(store.takeAny('anna', now)).toBeNull();

    store.save(
      { kind: 'admin-draft', page: '/admin/servers', draft: 'x'.repeat(DRAFT_MAX + 1) },
      'anna',
      now,
    );
    expect(store.takeAny('anna', now)).toBeNull();
  });
});
