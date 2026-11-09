# 0003. Anonymous installs: HMAC-SHA256 with a pepper, stateless JWT

Status: accepted

## Context

The product promise is "no accounts, no personal data". Some endpoints still need to recognise a returning install (opt-in profile, offers, erase). The server must not be able to link a stored row to a device identifier, and a database leak alone must not reveal or allow guessing of install ids. Users can reset their id on the device.

## Decision

The app generates a random UUID v4 and sends it on registration. The server stores only `id_hash = hex(HMAC-SHA256(lowercase(install_id), SERVER_PEPPER))`, never the raw id. The pepper is a >= 32-byte secret held in the environment, not in the database; without it the hash cannot be recomputed or brute-forced offline (the UUID space is already 122 bits, the pepper makes a leaked table useless).

Registration is an idempotent upsert by hash (`201` new, `200` existing) and returns a JWT: HS256, `sub = id_hash`, `typ = install`, lifetime 30 days (`JWT_TTL_DAYS`). The algorithm is pinned on both sign and verify.

Tokens are stateless, but the auth preHandler also checks that the install row still exists. Erasing an install therefore invalidates its token immediately (`401`), and the app re-registers.

## Consequences

- No credentials or recoverable identifiers on the server; the data model has no user concept.
- Rotating `SERVER_PEPPER` orphans every install: rows can no longer be matched, apps re-register as new installs, and old opt-in profiles become unreachable. It is a break-glass operation (see the runbook).
- Rotating `JWT_SECRET` merely forces silent re-registration.
- One indexed primary-key lookup per authenticated request in exchange for instant revocation on erase. At this scale that is negligible.
- A stolen token grants only that install's own tiny dataset until it expires or is erased.
- Whoever holds the raw UUID and a valid registration can act as that install; the UUID is a bearer secret on the device, not an authenticated identity.
