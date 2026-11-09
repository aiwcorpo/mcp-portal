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

  it('starts dark and offers the light theme', () => {
    const fixture = render();
    expect(button('Light mode', fixture.nativeElement)).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
  });

  it('lets the user go from dark to light and back, and remembers the choice', () => {
    const fixture = render();
    const service = TestBed.inject(ThemeService);

    button('Light mode', fixture.nativeElement).click();
    fixture.detectChanges();
    TestBed.tick();
    expect(service.mode()).toBe('light');
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(localStorage.getItem('mcp-portal-theme')).toBe('light');

    button('Dark mode', fixture.nativeElement).click();
    fixture.detectChanges();
    TestBed.tick();
    expect(service.mode()).toBe('dark');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
  });
});
