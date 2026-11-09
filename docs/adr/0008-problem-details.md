# 0008. RFC 9457 problem details for errors

Status: accepted

## Context

The Android client and operators need errors that are machine-readable, consistent across validation, auth, rate-limit and unexpected failures, and safe: nothing may leak stack traces, SQL or user-supplied values. Ad hoc `{ error: "..." }` bodies diverge as modules are added.

## Decision

Every error is `application/problem+json` per RFC 9457:
`{ type, title, status, detail, request_id }`, plus `errors: [{ path, message }]` for validation failures. `type` is `about:blank` for plain HTTP errors and `urn:poolamkoo:problem:<slug>` for application problems (`validation`, `unauthorized`, `not-found`, `rate-limited`, `payload-too-large`, `conflict`, `internal`). `request_id` equals the `X-Request-Id` response header so a user report can be matched to a log line.

Errors are created only through `ProblemError` and the `problems.*` factories in `src/lib/problem.ts`. A single Fastify error handler converts Zod/Fastify validation errors, oversize bodies and other client errors; anything else becomes a generic `internal` problem and the real error is logged server-side only. Unknown routes return a `404` problem. Rate limits return `429` with `Retry-After`.

## Consequences

- One error shape for clients to parse; `type` URNs are stable identifiers they can branch on.
- Throwing a bare `Error` from a handler yields a generic 500, never leaked internals.
- Validation messages come from Zod and are shown to clients, so they must not contain user-supplied values.
- The shape is part of the contract; changing it is a versioned change.
- Slightly more ceremony than `reply.send({ error })`, repaid by uniform tests and documentation.
