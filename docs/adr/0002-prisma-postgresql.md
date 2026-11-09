# 0002. Prisma 7 and PostgreSQL

Status: accepted

## Context

The data is relational and small: installs, optional profiles, offers, a normalised catalog (categories, merchants, icons), and immutable release blobs (catalog snapshots, signed rule packs). We need referential integrity, transactional imports, `ON DELETE CASCADE` for erasure, `bytea` for exact payloads, `jsonb` and arrays for a few structured columns, and committed, reviewable migrations. The operator already runs PostgreSQL tooling.

## Decision

PostgreSQL 16 as the only datastore. Prisma 7 as the access layer, using the `prisma-client` generator and `@prisma/adapter-pg` (driver adapter over `pg`), with the datasource URL in `prisma.config.ts`. Schema changes ship as SQL migrations committed under `prisma/migrations/`, applied by `prisma migrate deploy` in a one-shot container. Invariants Prisma cannot express (period regex, https-only URLs, colour format, platform) are hand-written `CHECK` constraints in the migration.

Repositories are the only code that imports the Prisma client. Where atomicity matters (install upsert returning created-vs-existing) a repository uses a single raw SQL statement.

Two roles: an owner that runs migrations, and `poolamkoo_app` with DML only (see ADR 0009 and the threat model).

## Consequences

- Typed queries and a readable schema file; migrations are plain SQL that reviewers can audit.
- Raw SQL needs explicit casts for the snake_case enum types.
- The generated client lives in `src/generated/` (gitignored) and must be generated after clone and after schema changes; CI and the Dockerfile do it.
- `CHECK` constraints are invisible to Prisma's drift detection; they are covered by integration tests.
- PostgreSQL is heavier than SQLite for a tiny service, but it gives real concurrency, roles and a path to managed hosting, and tests run against the same engine as production.
