# 0007. In-memory rate limiting and caches; no Redis

Status: accepted

## Context

The service runs as a single Node process on one small VPS with a 256 MB limit. It needs rate limiting (anonymous endpoints are open to the internet) and caching of two hot read paths (catalog snapshot, rule packs). Adding Redis would introduce another container, another failure mode and another place where state lives, to solve a distribution problem the deployment does not have.

## Decision

Use `@fastify/rate-limit` with its default in-memory store, and plain in-process caches with short TTLs. Limits: a global per-IP limit (`RATE_LIMIT_MAX`, default 120/min); `POST /v1/installs` 10/min per IP; install-scoped routes 60/min keyed by the verified JWT subject, and additionally counted against the global per-IP budget. IPv6 clients are keyed by their /64 prefix. Install-scoped routes authenticate after the limiters run, so failed attempts count and an over-limit flood never reaches the database. nginx adds an outer `limit_req` per client address. The client IP comes from `X-Forwarded-For` as overwritten by nginx, with `TRUST_PROXY=1` (one hop). Health checks are exempt and the 404 handler is limited explicitly.

## Consequences

- No extra infrastructure; zero network hops for limiting.
- Counters reset on restart and are per process. A deploy briefly clears them. This is acceptable: limits are abuse mitigation, not a billing control.
- Scaling to several instances would multiply the effective limits and let caches disagree for up to their TTL. At that point move limiting to a shared store (or the proxy) and keep the caches, which tolerate staleness by design. This ADR would be superseded then.
- Many users behind one carrier NAT share an IP bucket. `RATE_LIMIT_MAX` is configurable and install-scoped routes use a per-install key, which avoids the NAT problem where it matters most.
- Memory is bounded by the limiter's key count, which is small at expected traffic; the container memory limit is the backstop.
