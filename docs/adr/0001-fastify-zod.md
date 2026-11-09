# 0001. Fastify with the Zod type provider

Status: accepted

## Context

The API is small (about a dozen JSON endpoints) but has strict requirements: validated input, typed handlers, an OpenAPI document that cannot drift from the code, low per-request overhead on a 256 MB container, and structured logging with fine control over what is serialised. The contract is shared with an Android client, so a machine-readable schema is valuable.

Candidates: Express with hand-written validation, NestJS, Fastify with JSON Schema, Fastify with Zod.

## Decision

Use Fastify 5 with `fastify-type-provider-zod` and Zod 4. One Zod schema per request and response validates input, types the handler and produces the OpenAPI 3.1 document served by `@fastify/swagger` at `/docs`. Request bodies and queries are `z.strictObject`, so unknown keys are rejected. Response schemas are enforced, so a handler cannot leak extra fields.

Fastify's plugin model gives encapsulation for cross-cutting concerns (security, auth, errors, docs) and `app.inject()` makes in-process integration tests cheap. Pino is built in and its serializers let us whitelist log fields.

## Consequences

- Types, validation and documentation share one source; the Swagger UI is always accurate.
- Few runtime dependencies and fast startup; no decorators or DI container (wiring is a plain `createContainer`).
- Zod messages become client-visible `errors[].message`, so custom messages must not echo user input.
- Zod types that JSON Schema cannot express (transforms in responses, `z.date()`) are avoided.
- Smaller ecosystem and fewer conventions than NestJS. For this size that is a feature; the layering (routes, services, repositories) is enforced by convention and review instead of a framework.
