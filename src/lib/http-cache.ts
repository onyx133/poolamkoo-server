// Conditional-request helpers shared by cacheable endpoints (bands, catalog, rule packs).

// One entity-tag (optionally weak) or the `*` wildcard. Quoted tags may contain commas.
const ENTITY_TAG = /(?:W\/)?"[^"]*"|\*/g;

const opaque = (tag: string): string => (tag.startsWith('W/') ? tag.slice(2) : tag);

/**
 * True when an `If-None-Match` header matches `etag` (RFC 9110 weak comparison): the
 * response may then be a 304. Handles `W/` prefixes, comma-separated lists and `*`.
 * `etag` is the full quoted value, e.g. `"bands-3"`.
 */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const wanted = opaque(etag);
  for (const tag of header.match(ENTITY_TAG) ?? []) {
    if (tag === '*' || opaque(tag) === wanted) return true;
  }
  return false;
}
