import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

function shown(): HTMLElement[] {
  TestBed.inject(ApplicationRef).tick();
  return Array.from(document.querySelectorAll<HTMLElement>('app-notification-host .toast'));
}

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses status for a success and alert for an error', () => {
    service.success('Saved.');
    service.error('Not saved.');
    const [ok, failed] = shown();
    expect(ok.getAttribute('role')).toBe('status');
    expect(failed.getAttribute('role')).toBe('alert');
  });

  it('drops a success after 6 s and keeps an error until it is closed', () => {
    service.success('Saved.');
    service.error('Not saved.');
    vi.advanceTimersByTime(5900);
    expect(shown()).toHaveLength(2);
    vi.advanceTimersByTime(200);
    const left = shown();
    expect(left).toHaveLength(1);
    expect(left[0].textContent).toContain('Not saved.');
    vi.advanceTimersByTime(60_000);
    expect(shown()).toHaveLength(1);
    left[0].querySelector<HTMLButtonElement>('button.close')!.click();
    expect(shown()).toHaveLength(0);
  });

  it('holds the countdown while the pointer is over a success', () => {
    service.success('Saved.');
    vi.advanceTimersByTime(4000);
    shown()[0].dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(30_000);
    expect(shown()).toHaveLength(1);
    shown()[0].dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(1900);
    expect(shown()).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(shown()).toHaveLength(0);
  });

  it('shows at most three, newest at the bottom', () => {
    for (const text of ['one', 'two', 'three', 'four']) {
      service.error(text);
    }
    expect(shown().map((toast) => toast.querySelector('.text')?.textContent)).toEqual([
      'two',
      'three',
      'four',
    ]);
  });

  it('does not repeat the same message and restarts the countdown of a success', () => {
    service.success('Saved.');
    vi.advanceTimersByTime(5000);
    service.success('Saved.');
    expect(shown()).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(shown()).toHaveLength(1);
    vi.advanceTimersByTime(1100);
    expect(shown()).toHaveLength(0);
  });

  it('runs the action once and closes the notification', () => {
    const retry = vi.fn();
    service.failure(
      { code: 'upstream_unavailable', status: 503, requestId: '0123456789abcdef' },
      retry,
    );
    const [toast] = shown();
    expect(toast.textContent).toContain('The service is temporarily unavailable.');
    expect(toast.textContent).toContain('01234567');
    toast.querySelector<HTMLButtonElement>('button.action')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(shown()).toHaveLength(0);
  });
});
