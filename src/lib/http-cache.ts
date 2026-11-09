// Matches a strong or weak entity-tag in an If-None-Match list.
const ENTITY_TAG = /(?:W\/)?"[^"]*"/g;

function opaque(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/**
 * RFC 9110 If-None-Match with weak comparison: `*` matches anything, entries are
 * comma-separated and may carry a `W/` prefix. `etag` is the quoted tag, e.g. `"catalog-3"`.
 */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === '*') return true;
  const wanted = opaque(etag);
  return (header.match(ENTITY_TAG) ?? []).some((tag) => opaque(tag) === wanted);
}
