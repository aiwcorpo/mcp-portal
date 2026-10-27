/** ReturnPath from the C4/C12 contract (CC-032): portal-relative, no percent-encoding, no backslash. */
const RETURN_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@/?-]*$/;
const RETURN_PATH_MAX = 512;

export const LOGIN_PATH = '/api/v1/auth/login';

export function isValidReturnPath(path: string): boolean {
  return path.length <= RETURN_PATH_MAX && RETURN_PATH.test(path);
}

export function safeReturnPath(path: string | null | undefined): string {
  return path && isValidReturnPath(path) ? path : '/';
}

export function loginUrl(returnPath: string, stepUp = false): string {
  const params = new URLSearchParams({ returnPath: safeReturnPath(returnPath) });
  if (stepUp) {
    params.set('stepUp', 'true');
  }
  return `${LOGIN_PATH}?${params.toString()}`;
}

/**
 * The BFF builds stepUpUrl without knowing which screen sent the request, so the portal points its
 * returnPath back at the form. Only the BFF login endpoint on this origin is followed; anything else
 * falls back to a login URL built here, so a tampered response cannot redirect the browser elsewhere.
 */
export function stepUpUrlFor(
  stepUpUrl: string | undefined,
  returnPath: string,
  origin: string,
): string {
  if (stepUpUrl) {
    try {
      const url = new URL(stepUpUrl, origin);
      if (url.origin === origin && url.pathname === LOGIN_PATH) {
        url.searchParams.set('returnPath', safeReturnPath(returnPath));
        url.searchParams.set('stepUp', 'true');
        return `${url.pathname}${url.search}`;
      }
    } catch {
      // Malformed stepUpUrl: use the locally built login URL below.
    }
  }
  return loginUrl(returnPath, true);
}

/** External redirects (OAuth provider) must be plain http(s); never javascript: or data:. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
