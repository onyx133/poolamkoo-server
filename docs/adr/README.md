# Architecture decision records

Short records in the style of Michael Nygard: context, decision, consequences. A decision that is replaced gets a new ADR that supersedes the old one; old ADRs are not rewritten.

| # | Decision | Status |
|---|---|---|
| [0001](0001-fastify-zod.md) | Fastify with the Zod type provider | accepted |
| [0002](0002-prisma-postgresql.md) | Prisma 7 and PostgreSQL | accepted |
| [0003](0003-anonymous-installs-and-jwt.md) | Anonymous installs: HMAC-SHA256 with a pepper, stateless JWT | accepted |
| [0004](0004-ed25519-rule-pack-signatures.md) | Ed25519 detached signatures, offline signing, server only verifies | accepted |
| [0005](0005-operator-clis-no-admin-api.md) | No admin HTTP API; operator CLIs | accepted |
| [0006](0006-catalog-release-snapshots.md) | Normalised catalog, served from precomputed release snapshots | accepted |
| [0007](0007-in-memory-rate-limits-and-caches.md) | In-memory rate limiting and caches; no Redis | accepted |
| [0008](0008-problem-details.md) | RFC 9457 problem details for errors | accepted |
| [0009](0009-shared-vps-deployment.md) | Docker safe mode behind the host nginx on port 2053 | accepted |
| [0010](0010-testing-strategy.md) | Vitest, app.inject, real PostgreSQL | accepted |
