# Contributing

Issues and pull requests are welcome. The server is small on purpose; please read [docs/design.md](docs/design.md) and the [ADRs](docs/adr/README.md) before proposing structural changes.

## Setup

```sh
npm ci
cp .env.example .env          # set SERVER_PEPPER and JWT_SECRET: openssl rand -base64 48
npm run db:generate           # generates the Prisma client (gitignored)
```

Node.js 22 or newer (CI uses 24, see `.nvmrc`). Tests need no database setup: when `TEST_DATABASE_URL` is unset they start a throwaway PostgreSQL 16 through `embedded-postgres`.

## Before opening a pull request

```sh
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
npm audit --omit=dev --audit-level=high
```

CI runs the same checks plus a Docker build.

## Conventions

- Layering: routes parse and serialise and call a service; services hold logic and depend on repository interfaces; repositories are the only code that touches Prisma.
- Every request body and query uses a strict Zod object. Errors go through `problems.*` / `ProblemError`; never build error bodies by hand.
- Privacy invariants are tested and must stay true: no raw install id, IP, auth header or body in logs or storage; erase removes every row for the install; nothing accepts amounts, SMS text or contact details.
- Changes to the API need a matching change to [docs/api/contract-v1.md](docs/api/contract-v1.md), which is shared with the Android app. Additive changes only within v1.
- Schema changes need a new SQL migration; do not edit applied migrations.
- Add tests with the change: unit tests with fake repositories, integration tests through `app.inject()` against real Postgres.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `build:`, `chore:`).
- A significant design decision gets an ADR in `docs/adr/` (context, decision, consequences; one page).

## Security issues

Do not file them as public issues. See [SECURITY.md](SECURITY.md).
