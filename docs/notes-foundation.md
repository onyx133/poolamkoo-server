# Foundation notes (for module engineers and the docs writer)

Working notes from the foundation work. Not user-facing documentation.

## Quick start

```
npm ci
cp .env.example .env        # fill SERVER_PEPPER / JWT_SECRET (openssl rand -base64 48), DATABASE_URL
npm run db:generate         # Prisma client -> src/generated/prisma (gitignored, no postinstall hook)
npm run db:migrate && npm run db:seed
npm run dev
```

Gates: `npm run lint && npm run typecheck && npm test && npm run build`.
CI additionally runs `format:check` and `npm audit --omit=dev --audit-level=high`.

## Adding a module (`profile`, `offers`, `catalog`, `rule-packs`)

The schema and the initial migration already contain every table; do not edit them unless the
data model itself changes (then add a new migration: `prisma migrate dev` against a scratch DB,
or `prisma migrate diff` as in the foundation commit).

1. Create `src/modules/<name>/` with `<name>.schemas.ts` (Zod), `<name>.repository.ts`
   (interface + Prisma implementation), `<name>.service.ts` (logic, depends on the interface only),
   `<name>.routes.ts` (a `FastifyPluginAsyncZod<{ service: ... }>`). Copy `installs` as the template.
2. Wire it in two places, both marked `WIRE-HERE`: `src/container.ts` (interface + construction)
   and `src/app.ts` (`app.register(xRoutes, { prefix: '/v1', service: container.x })`).
3. Authenticated routes: spread `...installScoped(app)` into the route options (`src/plugins/auth.ts`).
   It sets `onRequest: app.limitByIp` (global per-IP budget), the per-install limiter (60/min keyed by
   the verified JWT subject, also in `onRequest`) and `preValidation: app.requireInstall`. Keep
   authentication out of `onRequest`: it must run after the limiters, so failed attempts are counted
   and a flood gets 429 without a DB lookup. The install's id hash is `request.install!.idHash`.
4. Public routes need no extra config (global per-IP limit applies). Per-route limit:
   `config: { rateLimit: { max, timeWindow } }`; opt out with `rateLimit: false`.
5. Tests: unit-test the service with a fake repository (`test/unit/installs.service.test.ts`),
   integration-test through `buildTestApp()` (`test/integration/installs.test.ts`).
   Add new table names to `TABLES` in `test/helpers/db.ts` if you add tables.
6. Put errors through `problems.*` / `ProblemError` (`src/lib/problem.ts`); never build error
   bodies by hand. Throwing anything else becomes a generic 500.

## How tests get a database

`test/helpers/global-setup.ts` (integration project only):

- `TEST_DATABASE_URL` set (CI): uses it as is, runs `prisma migrate deploy` against it.
- Otherwise starts a throwaway Postgres via the `embedded-postgres` devDependency (pinned to
  16.x to match production) on a random port in a temp dir, runs the real migrations, and deletes
  everything afterwards. Works on Windows; first run downloads nothing (binaries ship in the
  npm package) but needs ~5 s to boot.
- The URL reaches tests via Vitest `inject('testDatabaseUrl')`; `buildTestApp()` does that for you.
- `fileParallelism` is off for the integration project (one shared DB). Call
  `resetDb(prisma)` in `beforeEach`.
- `POST /v1/installs` is limited to 10/min/IP, so use `postInstall` / `registerInstall` from
  `test/helpers/fixtures.ts`, which send every request from a fresh fake IP (`remoteAddress`).
  To test a rate limit, build a separate app with a tiny `RATE_LIMIT_MAX` env override.
- `signTestJwt` (test/helpers/jwt.ts) mints expired or odd tokens.
- Pass `logStream` to `buildTestApp` to capture logs (see the logging-privacy test).

## Gotchas

Prisma 7

- The generator is `prisma-client` with output `src/generated/prisma` (gitignored). Import from
  `src/lib/prisma.ts` (`PrismaClient`, `createPrisma`) and from `../generated/prisma/client.js`
  for enums/types. Run `npm run db:generate` after cloning and after any schema change.
- The datasource URL is not in `schema.prisma`; it lives in `prisma.config.ts` (CLI) and
  `config.ts` + `@prisma/adapter-pg` (runtime). `DATABASE_URL` must be set for `prisma` CLI commands.
- Enums are mapped to snake_case Postgres types (`store`, `income_band`, `category_kind`), so raw
  SQL needs a cast, e.g. `${store}::store`.
- The migration appends hand-written `CHECK` constraints (platform, period regex, url https,
  color). Prisma does not know them; `prisma migrate diff` shows no drift because it ignores checks.
- Installs upsert uses raw SQL (`ON CONFLICT ... RETURNING xmax = 0`) to learn created-vs-existing
  atomically. Everything else can use the normal client.
- `bytea` columns are `Uint8Array` in Prisma 7 (`Buffer` is accepted on input).

Zod 4 / fastify-type-provider-zod 7

- Use `z.strictObject` for every request body/query (rejects unknown keys), `z.uuidv4()`,
  `z.iso.datetime()`, `z.coerce.number()` for query strings.
- Response schemas are enforced: extra keys are stripped and a mismatch becomes a 500 `internal`
  problem. Do not declare schemas for 204 or for raw-bytes responses (rule packs, catalog body:
  send a Buffer with explicit headers and no response schema).
- Zod issue messages are what clients see in `errors[].message`; keep custom messages free of
  user-supplied values.
- OpenAPI is generated by `jsonSchemaTransform`; avoid Zod types that cannot be expressed in
  JSON Schema (transforms in response schemas, `z.date()`).

Fastify / plugins

- Plugin order in `app.ts` matters: security before error-handler (the 404 handler applies the
  rate limiter), swagger before the route modules.
- `@fastify/rate-limit` does not cover Fastify's 404 handler by default; `error-handler.ts` does it
  explicitly. Error handler and decorators are `fastify-plugin` wrapped so they are not encapsulated.
- `@fastify/jwt` `expiresIn` as a number is **seconds**.
- Fastify's `trustProxy` typings omit a hop-count `number`; it is accepted at runtime (cast in `app.ts`).
- Logs: only whitelisted request fields are serialized (`method`, `route`, `path` without query);
  `GET /v1/health` is silent. The listen message is overridden so server IPs are not logged either.
- Request bodies are limited to 16 KiB and only `application/json` is parsed (text/plain parser removed).
  The JSON parser is Fastify's default except that an empty body parses as `undefined` (bodiless DELETEs
  that still send `Content-Type: application/json`); routes with a body schema then answer 400.
- Every `keyGenerator` goes through `ipRateLimitKey` (`src/lib/ip.ts`): IPv4 as is, IPv6 by /64.
- `/v1/health` pings the database (`SELECT 1`, 1 s) and answers `503 {status:"degraded"}` when it fails;
  the contract only lists `200`, so this is an additive status for monitoring.
- Security headers: strict CSP for the API, Swagger UI's `staticCSP` for `/docs` only.
- Config: `loadConfig` (API), `loadDbConfig` / `loadRulePackCliConfig` / `loadRetentionDays` (CLIs).
  New variables: `DB_POOL_MAX`, `INSTALL_RETENTION_DAYS`. Secrets must be canonical base64 or hex.
- Retention: `startRetentionJob` (src/modules/installs/installs.retention.ts) runs from `server.ts`;
  `installs:prune` is the manual twin. Importers (`catalog`, `rule-packs`, `bands`) serialize with
  `pg_advisory_xact_lock` (keys 7361001/2/3).

## Docker / ops

- `docker compose up --build`: postgres:16-alpine (init script creates the non-superuser roles
  `poolamkoo_owner` and `poolamkoo_app`; the bootstrap superuser is `poolamkoo_admin`), one-shot
  `migrate` (Dockerfile target `migrate`, owner role), then `api` (target `runtime`, role
  `poolamkoo_app`, read-only root filesystem). The runtime image contains `seed/`, so
  `docker compose run --rm --no-deps api node dist/cli/bands-import.js seed/bands.json` works.
  CI has a `smoke` job doing exactly this. The Dockerfile's last stage is `runtime`, so a plain `docker build .` yields the
  API image. The Docker files could not be executed on the authoring machine (no Docker).
- `deploy/db-init/01-app-role.sh` only runs on first initialisation of the data volume; on an
  existing database apply the same SQL by hand (the RUNBOOK explains how to move a pre-split volume).
- The seed (`npm run db:seed`) is idempotent, loads `seed/bands.json`, then calls `seedCatalog`
  in `prisma/seed-catalog.ts` (a stub: the catalog engineer fills it in). Seeding needs the owner
  (or any role with INSERT), not necessarily `poolamkoo_app`.

## Spec points the docs writer should know

- The contract example for `GET /v1/profile/bands` shows B1 = 200000000, `seed/bands.json` uses the
  lead's values (150000000 / 300000000 / 600000000 / 1200000000 / null). The numbers are data, not API.
- The contract says erase removes "offer impressions"; design.md says impressions are not recorded.
  Server behaviour follows design.md (erase = installs + cascading profile).
- `expires_at` is rendered as `YYYY-MM-DDTHH:MM:SSZ` (no milliseconds), like the contract example.
