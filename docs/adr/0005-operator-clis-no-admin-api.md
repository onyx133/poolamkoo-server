# 0005. No admin HTTP API; operator CLIs

Status: accepted

## Context

Someone has to publish catalog updates, rule packs and offers. The usual answer is an authenticated admin API or dashboard. That adds a credential store, a login surface, authorisation logic and a path from the internet to write access on the database, all for a service run by one person who deploys a few times a month.

## Decision

The HTTP API is read-mostly and exposes no operator or admin functionality. Content is published with CLIs shipped in the same image (`dist/cli/*`): `catalog:import`, `rulepack:keygen|sign|import`, `offers:import`. They run on the server as one-off containers against the same database, with input files copied over SSH. Each validates its input (Zod for catalog and offers, signature verification for rule packs) and runs in a transaction. Destructive effects need an explicit flag (`--allow-removals`) or are impossible (rule-pack versions only increase).

## Consequences

- The attack surface has no admin login, no admin tokens and nothing to brute-force. Compromising the public API does not provide a publishing path.
- Access control is SSH access to the host, which already exists and is stronger than anything we would build.
- Content changes are files, so they can be reviewed, versioned in git and replayed.
- Less convenient than a web UI and not suitable for non-technical editors. Acceptable at this scale; revisit if several people must publish.
- CLIs share services and repositories with the API, so validation rules cannot diverge between the two paths.
