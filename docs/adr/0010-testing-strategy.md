# 0010. Testing strategy: Vitest, app.inject, real PostgreSQL

Status: accepted

## Context

Most of the risk in this service sits at boundaries: SQL constraints, upsert semantics, cascades, header handling, rate limits, and what ends up in logs. Mocking the database would test the mocks. At the same time, business logic should be testable without infrastructure, and the privacy invariants must be enforced by tests, not by convention.

## Decision

Vitest with two projects.

- **unit**: services tested against fake repository implementations (services depend on interfaces), plus pure helpers (config parsing, HMAC, problem factories, signature handling).
- **integration**: the whole Fastify app through `app.inject()` (no sockets) against a real PostgreSQL 16 with the real migrations. Locally, when `TEST_DATABASE_URL` is unset, global setup boots a throwaway `embedded-postgres` instance on a random port (pinned to 16.x to match production) and deletes it afterwards. In CI a `postgres:16` service container is used. Files run serially against one database and reset it in `beforeEach`.

Privacy invariants have explicit tests: no raw install id stored, no IP, authorisation header or body in captured logs, erase removes every row, unknown fields rejected. Rate-limit tests build a separate app with a tiny limit. CI also runs lint, Prettier, `tsc --noEmit`, the build, `npm audit --omit=dev --audit-level=high` and a Docker build of both targets.

## Consequences

- Constraint, migration and cascade bugs are caught before deploy; the same engine runs locally, in CI and in production.
- Contributors need no Docker or local Postgres to run the suite; the first run boots the embedded server in a few seconds.
- Integration tests are slower than pure unit tests and cannot run file-parallel. At this size the full suite stays in the tens of seconds.
- `inject()` does not exercise nginx, TLS or compression negotiation over a real socket; those are covered by the runbook's smoke checks.
