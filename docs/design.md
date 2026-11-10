# PoolamKoo Server — design (lead's spec)

This is the binding implementation spec for everyone working in this repo. The API
contract is `docs/api/contract-v1.md` (owned by the app team; do not drift — propose
changes instead). Where this spec and the contract disagree, the contract wins.

## Stack (each choice gets an ADR in `docs/adr/`)

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS (engines `>=22`), ESM, TypeScript `strict` + `noUncheckedIndexedAccess` |
| HTTP | Fastify 5 + `fastify-type-provider-zod` (Zod 4) — schemas validate and generate OpenAPI |
| Docs | `@fastify/swagger` (OpenAPI 3.1 from Zod) + `@fastify/swagger-ui` at `/docs` |
| Security | `@fastify/helmet`, `@fastify/rate-limit` (in-memory), `@fastify/jwt` (HS256), `@fastify/compress` (br/gzip) |
| DB | PostgreSQL 16, Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`, `prisma.config.ts`), SQL migrations committed |
| Logs | pino (Fastify built-in), request ids, redaction, **no PII, no IPs, no bodies** |
| Tests | Vitest; unit tests with fake repositories; integration tests via `app.inject()` on a real Postgres (CI: service container; local: `embedded-postgres` when `TEST_DATABASE_URL` is unset) |
| Quality | ESLint (typescript-eslint, flat config) + Prettier, `tsc --noEmit`, `npm audit --omit=dev` clean |
| Ship | multi-stage Dockerfile (non-root, `node:24-alpine`), `docker-compose.yml` (api + postgres + one-shot migrate), GitHub Actions CI, Dependabot |

No Redis, Kafka or Kubernetes. Single process; in-memory rate limits and caches are fine.

## Layout

```
src/
  server.ts            entry: config → prisma → container → buildApp → listen; graceful shutdown (SIGINT/SIGTERM: app.close(), prisma.$disconnect(), hard-exit timeout)
  app.ts               buildApp(container, config): FastifyInstance — registers plugins + modules; no globals
  config.ts            loadConfig(env): zod-validated, frozen; fails fast with a readable message
  container.ts         createContainer(config, prisma): wires repositories → services (DI by construction)
  lib/                 problem.ts (ProblemError + factories), crypto.ts (hmacInstallId, ed25519 helpers), http-cache.ts (etag helpers)
  plugins/             error-handler.ts, security.ts (helmet/compress/rate-limit), auth.ts (jwt + requireInstall preHandler), swagger.ts
  modules/<name>/      <name>.routes.ts  <name>.service.ts  <name>.repository.ts  <name>.schemas.ts
                       modules: health, installs, profile (profile + bands), offers, catalog, rule-packs
  cli/                 operator commands (run with `node dist/cli/<cmd>.js` / `npm run <cmd>`)
prisma/                schema.prisma, migrations/, seed.ts
seed/                  catalog-seed.json (placeholder), bands.json, offers.json (examples)
test/                  unit/, integration/, helpers/ (buildTestApp, db reset, global-setup)
deploy/                production compose override, reverse-proxy config, db role init, runbook
```

Rules: routes only parse/serialize and call a service; services hold logic and depend on
repository *interfaces*; repositories are the only code that touches Prisma. Small files,
no clever abstractions, comments only where intent is non-obvious.

## Configuration (env, validated)

`NODE_ENV`, `HOST` (default `0.0.0.0`), `PORT` (default 3000), `LOG_LEVEL`,
`DATABASE_URL`, `DB_POOL_MAX` (default 10), `SERVER_PEPPER` (≥32 bytes, canonical base64 or hex), `JWT_SECRET` (≥32 bytes, same format),
`JWT_TTL_DAYS` (default 30), `TRUST_PROXY` (false | true | hop count | CIDR list),
`RULEPACK_PUBLIC_KEY` (canonical base64 of the raw 32-byte Ed25519 public key — read only by
`rulepack:import` to *verify* packs; the private key never reaches the server), `RATE_LIMIT_MAX`
(per IP per minute, default 120), `INSTALL_RETENTION_DAYS` (default 180, 0 = never delete),
`DOCS_ENABLED` (default true), `APP_VERSION` (defaults to package.json). CLIs load only the
variables they use (`loadDbConfig` etc.).
`.env.example` documents all; real `.env` files are gitignored.

## Data model (PostgreSQL, snake_case tables/columns via `@@map`/`@map`)

- `installs`: `id_hash char(64) PK` (hex HMAC-SHA256(install_id, SERVER_PEPPER)),
  `platform` ('android'), `app_version` varchar(32), `store` enum(bazaar,myket,play,direct),
  `created_at`, `last_seen_on date` (day granularity on purpose). Nothing else.
- `profiles`: `install_id_hash PK/FK → installs ON DELETE CASCADE`, `income_band`
  enum(B1..B5), `period` varchar(7) (`^\d{4}-(0[1-9]|1[0-2])$`, Jalali year-month),
  `consent_version int`, `updated_at`. Latest value only.
- `band_tables`: `version int PK`, `currency` ('IRR'), `bands jsonb`
  (`[{key, max_monthly_net_income: number|null}]`, ascending; last band may be null =
  unbounded), `created_at`. Latest version is served.
- `offers`: `id varchar PK` (`o_…`), `title_fa`, `body_fa`, `cta_fa`, `url` (https only),
  `bands income_band[]`, `starts_at`, `expires_at`, `active bool`. We do **not** record
  impressions (data minimisation) — erase therefore only needs installs+profiles.
- Catalog (normalised source of truth): `categories` (`key PK`, `parent_key → categories`,
  `kind` enum(expense,income,neutral), `name_fa`, `color` `#RRGGBB`, `icon_key → icons`,
  `sort int`), `merchants` (`key PK`, `name_fa`, `category_key → categories`,
  `icon_key → icons`, `keywords text[]`), `icons` (`key PK`, `view_box_w`, `view_box_h`,
  `layers jsonb` = `[{role: plate|glyph|accent, d}]`).
- `catalog_releases`: `version int PK`, `etag`, `body bytea` (the exact serialized
  `/v1/catalog` JSON), `sha256`, `created_at`. Built at import time; GET serves the latest
  body from an in-memory cache (re-checked against the DB at most every 30 s).
- `rule_packs`: `version int PK`, `format_version int`, `min_app_version int`,
  `payload bytea` (exact bytes), `signature text` (base64 Ed25519 over payload),
  `sha256`, `created_at`.

DB roles (least privilege): a bootstrap superuser (`poolamkoo_admin`, socket only) creates two
non-superuser roles — `poolamkoo_owner` owns the database/schema and runs migrations; the API
connects as `poolamkoo_app` with only SELECT/INSERT/UPDATE/DELETE on the tables and USAGE on
sequences. TCP always needs a password (`--auth-host=scram-sha-256`).

## API behaviour (all under `/v1`, snake_case JSON)

- Every response carries `X-Request-Id` (honour an incoming one only if it matches
  `^[A-Za-z0-9-]{8,64}$`, else generate a UUID).
- Errors: RFC 9457, `Content-Type: application/problem+json`,
  `{type, title, status, detail, request_id}` plus `errors: [{path, message}]` for
  validation. `type` = `about:blank` for plain HTTP errors, else
  `urn:poolamkoo:problem:<slug>` (`validation`, `unauthorized`, `not-found`,
  `rate-limited`, `payload-too-large`, `conflict`, `internal`). 5xx never leak internals.
  Unknown routes → 404 problem.
- Body limit 16 KiB globally (no endpoint needs more). Strict Zod objects (reject unknown
  keys on requests). JSON only; an empty `application/json` body counts as no body.
- Rate limits: global per IP (`RATE_LIMIT_MAX`/min, IPv6 clients by /64); `POST /v1/installs`
  10/min per IP; install-scoped routes keyed by JWT `sub` (60/min) and also counted against the
  global per-IP limit. Limiters run in `onRequest`, authentication in `preValidation`, so failed
  attempts are counted and over-limit requests never reach the DB. `429` with `Retry-After` +
  problem body. nginx adds an outer `limit_req`.
- `GET /v1/health` → `{status:"ok", version}` after a `SELECT 1` (1 s timeout); database down →
  `503 {status:"degraded", version}`. Excluded from rate limit and access logs.
- `POST /v1/installs`: body `{install_id: uuid v4, platform: "android", app_version
  (≤32 chars, semver-ish), store}`. Upsert by HMAC; `201` new / `200` existing; refreshes
  `app_version`, `store`, `last_seen_on`. Returns `{access_token, expires_at}`; JWT
  `sub` = id_hash, `exp` = now + JWT_TTL_DAYS, `iat`, `typ: "install"`.
- Auth (`preValidation`): verify JWT, `exp`/`sub`/`typ` required (`401` problem if missing/invalid/expired), then confirm the
  install row still exists (erased → `401`, so the app re-registers). Touch
  `last_seen_on` at most once per day.
- `DELETE /v1/installs/me` → delete install (profile cascades) → `204`.
- `PUT /v1/installs/me/profile` → upsert `{income_band, period, consent_version≥1}` → `204`.
  `DELETE /v1/installs/me/profile` → `204` (idempotent).
- `GET /v1/profile/bands` (no auth) → latest band table; cacheable (`ETag "bands-<v>"`).
- `GET /v1/offers` (auth) → active, unexpired offers whose `bands` contain the install's
  band; `{offers: []}` without a profile. `Cache-Control: private, no-store`.
- `GET /v1/catalog` → latest release body, `ETag "catalog-<version>"`,
  `Cache-Control: public, max-age=300`; `If-None-Match` match (incl. `W/` and lists) → `304`.
  No release yet → `404` problem.
- `GET /v1/rule-packs/latest?app_version=<int versionCode>` → newest pack with
  `min_app_version <= app_version`; body = stored bytes verbatim, `Content-Type:
  application/json`, `X-Rule-Pack-Version`, `X-Signature`, `ETag "rulepack-<v>"`,
  `304` on match, `404` problem when none. `app_version` is the Android **versionCode**
  (the app's `RulePackLoader` compares `minAppVersion: Int` against it).
- Compression br/gzip above 1 KiB. Helmet with a strict CSP for the API (`default-src 'none'`);
  Swagger UI's own CSP only under `/docs`.

## Operator CLIs (no admin HTTP surface at all — smaller attack surface)

- `rulepack:keygen` → writes an Ed25519 keypair (private PEM to a path *outside* the repo,
  prints base64 raw public key).
- `rulepack:sign <pack.json> --key <private.pem>` → writes `<pack.json>.sig` (base64).
  Runs on the release machine, never on the server.
- `rulepack:import <pack.json> <pack.json.sig>` → validates JSON (`formatVersion`,
  `version`, `minAppVersion` ints), verifies the signature with `RULEPACK_PUBLIC_KEY`,
  refuses a version ≤ an existing one, stores bytes verbatim.
- `catalog:import <catalog-seed.json> [--allow-removals]` → Zod-validates against the
  `/v1/catalog` schema (referential integrity: parent/category/icon keys exist, unique
  keys, colors, kinds), refuses to drop existing keys unless `--allow-removals`, upserts in
  one transaction and writes a new `catalog_releases` row (version = seed `version`, must
  be greater than the current one).
- `offers:import <offers.json>` → replaces the offer set in one transaction.
- `bands:import <bands.json>` → validates (ascending, only the last band unbounded) and inserts a new
  `band_tables` version that must exceed the current one (advisory lock).
- `installs:prune [--days N]` → deletes installs not seen for N days (default
  `INSTALL_RETENTION_DAYS`); the API runs the same clean-up daily in-process.
- `prisma db seed` → loads `seed/bands.json` and the placeholder catalog if empty.

## Privacy & security invariants (tests must cover these)

1. The raw `install_id` is never stored or logged; only the HMAC.
2. Logs contain no IPs, no `authorization` header, no request/response bodies.
3. Erase deletes every row tied to the install.
4. Nothing accepts amounts, transactions, SMS text, phone numbers or emails.
5. Rule packs are verified against the public key before storage; the server never holds
   the private key.
