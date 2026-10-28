import { HttpInterceptorFn } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';

/**
 * CSRF cookie names in order of preference: the contract name (CC-055) first, then the name the BFF
 * used up to M1. Angular's built-in interceptor takes a single name, so it is replaced by this one.
 */
const XSRF_COOKIES = ['__Host-XSRF-TOKEN', 'XSRF-TOKEN'] as const;
const XSRF_HEADER = 'X-XSRF-TOKEN';
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export const xsrfInterceptor: HttpInterceptorFn = (request, next) => {
  const sameOrigin = !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(request.url);
  if (SAFE_METHODS.has(request.method) || !sameOrigin || request.headers.has(XSRF_HEADER)) {
    return next(request);
  }
  const cookies = inject(DOCUMENT).cookie;
  for (const name of XSRF_COOKIES) {
    const token = readCookie(cookies, name);
    if (token) {
      return next(request.clone({ headers: request.headers.set(XSRF_HEADER, token) }));
    }
  }
  return next(request);
};
