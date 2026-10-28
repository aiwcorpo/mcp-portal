import { Resource } from '../api/generated';

/** "Confluence DEV / 48213" (mockups 06, 14): system, parent id when there is one, resource id. */
export function formatResource(resource: Resource | null | undefined): string {
  if (!resource) {
    return '';
  }
  const system = resource.type.split('::')[0];
  const parent = resource.parent?.split('::').pop();
  return parent ? `${system} ${parent} / ${resource.id}` : `${system} ${resource.id}`;
}
