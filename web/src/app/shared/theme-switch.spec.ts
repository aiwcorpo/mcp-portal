import { TestBed } from '@angular/core/testing';
import { ThemeService } from '../core/theme.service';
import { button } from '../../testing/test-app';
import { ThemeSwitch } from './theme-switch';

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.removeItem('mcp-portal-theme');
    document.documentElement.classList.remove('theme-dark', 'theme-light');
  });

  function render() {
    const fixture = TestBed.createComponent(ThemeSwitch);
    fixture.detectChanges();
    return fixture;
  }

  it('starts dark and marks the active theme', () => {
    const fixture = render();
    expect(button('Dark', fixture.nativeElement).getAttribute('aria-pressed')).toBe('true');
    expect(button('Light', fixture.nativeElement).getAttribute('aria-pressed')).toBe('false');
  });

  it('lets the user go from dark to light and back, and remembers the choice', () => {
    const fixture = render();
    const service = TestBed.inject(ThemeService);

    button('Light', fixture.nativeElement).click();
    fixture.detectChanges();
    TestBed.tick();
    expect(service.mode()).toBe('light');
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(localStorage.getItem('mcp-portal-theme')).toBe('light');
    expect(button('Light', fixture.nativeElement).getAttribute('aria-pressed')).toBe('true');

    button('Dark', fixture.nativeElement).click();
    fixture.detectChanges();
    TestBed.tick();
    expect(service.mode()).toBe('dark');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
  });

  it('keeps both buttons enabled in either theme', () => {
    const fixture = render();
    for (const name of ['Light', 'Dark']) {
      button(name, fixture.nativeElement).click();
      fixture.detectChanges();
      expect(button('Light', fixture.nativeElement).disabled).toBe(false);
      expect(button('Dark', fixture.nativeElement).disabled).toBe(false);
    }
  });
});
