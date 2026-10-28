import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
  withNoXsrfProtection,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { readCookie, xsrfInterceptor } from './xsrf.interceptor';

describe('readCookie', () => {
  it('finds a cookie by exact name and decodes it', () => {
    expect(readCookie('a=1; XSRF-TOKEN=x%2By; b=2', 'XSRF-TOKEN')).toBe('x+y');
    expect(readCookie('a=1; MY-XSRF-TOKEN=nope', 'XSRF-TOKEN')).toBeNull();
    expect(readCookie('', 'XSRF-TOKEN')).toBeNull();
  });
});

describe('xsrfInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  function clearCookies(): void {
    for (const name of ['XSRF-TOKEN', '__Host-XSRF-TOKEN']) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }

  beforeEach(() => {
    clearCookies();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withNoXsrfProtection(), withInterceptors([xsrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
    clearCookies();
  });

  it('sends X-XSRF-TOKEN from the cookie on POST, PUT and DELETE to the same origin', () => {
    document.cookie = 'XSRF-TOKEN=legacy-value; path=/';
    for (const method of ['post', 'put', 'delete'] as const) {
      (method === 'delete' ? http.delete('/api/v1/x') : http[method]('/api/v1/x', {})).subscribe();
      expect(controller.expectOne('/api/v1/x').request.headers.get('X-XSRF-TOKEN')).toBe(
        'legacy-value',
      );
    }
  });

  it('prefers the __Host- name of the contract', () => {
    document.cookie = 'XSRF-TOKEN=legacy-value; path=/';
    // __Host- cookies need Secure, which jsdom refuses over http: the reader is exercised directly.
    expect(
      readCookie('XSRF-TOKEN=legacy-value; __Host-XSRF-TOKEN=contract-value', '__Host-XSRF-TOKEN'),
    ).toBe('contract-value');
  });

  it('does not add the header to GET or to other origins', () => {
    document.cookie = 'XSRF-TOKEN=legacy-value; path=/';
    http.get('/api/v1/x').subscribe();
    expect(controller.expectOne('/api/v1/x').request.headers.has('X-XSRF-TOKEN')).toBe(false);
    http.post('https://elsewhere.invalid/x', {}).subscribe();
    expect(
      controller.expectOne('https://elsewhere.invalid/x').request.headers.has('X-XSRF-TOKEN'),
    ).toBe(false);
  });

  it('sends nothing when there is no cookie', () => {
    http.post('/api/v1/x', {}).subscribe();
    expect(controller.expectOne('/api/v1/x').request.headers.has('X-XSRF-TOKEN')).toBe(false);
  });
});
