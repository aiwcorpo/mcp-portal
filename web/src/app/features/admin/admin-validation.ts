/**
 * Value rules of common.schema.json and of the admin schemas that the forms check before sending, so a typing
 * mistake is shown next to the field. The gateway and the broker check everything again; what only they can know
 * (is the type declared, does the scope fit its pattern) comes back as a rejection.
 */
const RESERVED =
  'gateway|offboarding|portal|broker|prometheus|platform|admin|registry|adapter|internal|ci';

export const SYSTEM_ID = new RegExp(`^(?!(?:${RESERVED})$)[a-z][a-z0-9]{1,30}$`);
export const SERVER_ID = new RegExp(`^mcp-(?!(?:${RESERVED})$)[a-z][a-z0-9]{1,30}$`);
export const GROUP_NAME = /^mcp-[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const RESOURCE_SCOPE_ID = /^[A-Z][A-Za-z0-9]{0,30}::[A-Z][A-Za-z0-9]{0,30}\/[!-~]{1,1024}$/;
export const OVERRIDE_NAME = /^[a-z0-9][a-z0-9-]{0,54}$/;
export const OVERRIDE_TEXT_MAX = 8000;
export const TLS_NAME = /^[A-Za-z0-9.-]{1,253}$/;
export const OAUTH_SCOPE = /^[^\s]{1,200}$/;
/** ISO 8601 duration of the calls of the broker, up to ten minutes (the broker checks the value). */
export const DURATION = /^PT(?:(?:[0-9]{1,2})M)?(?:(?:[0-9]{1,3})S)?$/;

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** One scope per line (or separated by commas or spaces); empty entries are dropped, duplicates are kept for the check. */
export function splitList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function overrideTemplate(id: string, target: string): string {
  const subject =
    target === 'gateway' ? 'action == Action::"call", resource is Tool' : 'action, resource';
  const condition =
    target === 'gateway' ? 'resource.name == "tool_name"' : 'resource.scopes.isEmpty()';
  return `@id("${id}")\nforbid (principal, ${subject})\nwhen { ${condition} };`;
}
