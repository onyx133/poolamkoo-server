# 0006. Normalised catalog, served from precomputed release snapshots

Status: accepted

## Context

The catalog (categories, merchants, icons) is edited as a whole by a maintainer and read by every app instance. Editing benefits from normalised tables with referential integrity (a merchant must point at an existing category and icon). Reading wants the cheapest possible response: the same bytes for everyone, a stable `ETag`, and `304` when unchanged. Building JSON from many rows on each request would be wasteful and could make the `ETag` unstable.

## Decision

Keep the catalog in normalised tables as the source of truth and, at import time, serialise the exact `/v1/catalog` response into a `catalog_releases` row (`version`, `etag`, `body bytea`, `sha256`). `GET /v1/catalog` serves the latest body from an in-memory cache, re-checking the database at most every 30 seconds, with `ETag: "catalog-<version>"` and `Cache-Control: public, max-age=300`. A matching `If-None-Match` (including weak validators and lists) returns `304`.

The import CLI validates the seed against the response schema (unique keys, existing parent/category/icon keys, colour format, kinds), refuses to remove existing keys without `--allow-removals`, requires a greater `version`, and writes tables and release in one transaction. Keys are stable forever; renames change only `name_fa`.

## Consequences

- Reads are a cache hit plus a byte copy; the `ETag` is derived from the version and cannot change without a new release.
- Releases are immutable history, so any past response can be reproduced and diffed.
- Data is stored twice (tables and snapshot). The size is tens of kilobytes, so the cost is irrelevant.
- A new release can take up to 30 seconds to reach a given process, and up to 5 minutes to reach clients with a warm HTTP cache. Acceptable for catalog data.
- The snapshot must be built by the same code path as the response schema, otherwise the tables and the served body could disagree; the importer owns both.
