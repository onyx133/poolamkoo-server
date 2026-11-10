# Privacy

PoolamKoo is built so the server can be breached without exposing anything about a person's finances. SMS parsing, transactions, amounts and budgets exist only on the user's device. This document lists everything the server holds and everything it refuses to receive. It describes the implementation; the invariants below are covered by automated tests.

## Data inventory

| Data | Where | Why | Retention | Erased by |
|---|---|---|---|---|
| Install id hash: `HMAC-SHA256(install_id, SERVER_PEPPER)`, 64 hex chars | `installs.id_hash` (primary key) | Recognise a returning install without storing the identifier | Until erased, or deleted automatically after `INSTALL_RETENTION_DAYS` (default 180) days without a visit | `DELETE /v1/installs/me` |
| `platform` (`android`), `app_version`, `store` (`bazaar`, `myket`, `play`, `direct`) | `installs` | Serve a compatible rule pack; know which stores matter | Same as the hash row; refreshed on each registration | same |
| `created_at` | `installs` | Operational | Same as the hash row | same |
| `last_seen_on`, **day granularity** (a date, not a timestamp) | `installs` | Count active installs and find dormant ones to delete (retention) | Same as the hash row | same |
| Opt-in profile: `income_band` (B1..B5), `period` (Jalali `YYYY-MM`), `consent_version` | `profiles` (FK to `installs`, `ON DELETE CASCADE`) | Select which offers to show. Only the latest value is kept | Until the user withdraws or erases; deleted with its install by retention | `DELETE /v1/installs/me/profile` or the install erase (cascade) |
| Offers, catalog, band table, rule packs | other tables | Published content, not user data | Managed by the operator | n/a |

There is no other table that references an install. Offers are shown without recording impressions, so erasing an install needs only the install row and its cascading profile.

## What the server never receives

The API has no field for, and its strict request schemas reject, any of: SMS text or sender, transactions, amounts or balances, account or card numbers, phone numbers, email addresses, names, contacts, device identifiers (IMEI, Android ID, advertising id), location, or the exact income. Unknown JSON keys in a request are a `400`. The income band is computed on the device; the server only learns which of five coarse ranges it falls in, and only after an explicit, revocable opt-in.

## What is not tracked

- No impression, click or conversion tracking for offers.
- No analytics or third-party SDKs; the server makes no outbound calls.
- No per-request history: `last_seen_on` is a single date column overwritten at most once a day, not a log.

## Logging

Application logs (pino, JSON) contain the request id, HTTP method, route, path without the query string, status code and, for errors, the error. They do not contain client IPs (the default `remoteAddress` is not serialised and the listen message omits interface addresses), request or response bodies, the `Authorization` header or any token. Redaction is a second layer behind field whitelisting. `GET /v1/health` is not logged. nginx runs with `access_log off`. The nginx error log is shared with the host and can mention client IPs for failed connections; that is the one place an IP can appear, and it is host-level, short-lived and not used for anything.

The raw `install_id` exists only in the body of `POST /v1/installs` while it is hashed; it is never stored or logged.

## Erasure and reset

- **Erase** (`DELETE /v1/installs/me`, authenticated): deletes the install row; the profile cascades. The access token stops working at once because authentication checks that the install still exists, so the app re-registers as a fresh install if it continues to use online features. Backups made before the erase can still contain the row until they age out (see the runbook's backup retention).
- **Retention** (automatic): the API deletes every install whose `last_seen_on` is more than `INSTALL_RETENTION_DAYS` days old (default 180; `0` turns it off) once a day, and the profile goes with it. Operators can run it by hand with `npm run installs:prune -- --days N`. Backups taken before a deletion keep the row until they age out.
- **Withdraw opt-in** (`DELETE /v1/installs/me/profile`): removes only the profile; idempotent.
- **Reset install id** (in the app): the app generates a new UUID. The old hash row stays until it is erased, so the app should call erase first. Without that, the old row is orphaned: it can no longer be linked to the device by anyone, and holds only the data listed above.
- **Pepper rotation** orphans every install row by design (see [ADR 0003](adr/0003-anonymous-installs-and-jwt.md)); the operator then truncates `installs`.

## Why the hash is not reversible

The install id is a random UUID v4 (122 bits). The server stores a keyed hash, and the key (`SERVER_PEPPER`) lives in the environment, not the database. A database dump alone cannot be used to test guesses. Someone with both the dump and the pepper could confirm a specific id they already have, but cannot enumerate ids.

## Invariants (tested)

1. The raw install id is never stored or logged.
2. Logs contain no IPs, no `Authorization` header and no request or response bodies.
3. Erase deletes every row tied to the install.
4. No endpoint accepts amounts, transactions, SMS text, phone numbers or emails.
5. Rule packs are verified against the public key before storage; the server never holds the private key.
