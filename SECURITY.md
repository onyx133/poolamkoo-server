# Security policy

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). Do not open a public issue for anything that could be exploited.

Include what you found, how to reproduce it, and the impact you expect. You can expect an acknowledgement within a few days and a fix or a reasoned assessment within 30 days. This is a small personal project maintained by one person; there is no bug bounty.

## Scope

In scope:

- the API in this repository (`src/`), including authentication, rate limiting, input validation and error handling;
- the operator CLIs, in particular signature verification of rule packs and catalog validation;
- the deployment files in `deploy/` and the Docker images;
- anything that would let a caller learn another install's data, forge or bypass rule-pack verification, or make the server store or log data it is documented never to hold (see [docs/privacy.md](docs/privacy.md)).

Out of scope:

- volumetric denial of service against the public instance (rate limits are best effort on a single small host);
- findings that need a compromised host, a leaked `.env` or a leaked rule-pack private key (these are covered by the [threat model](docs/threat-model.md) as residual risks);
- the Android app (report to [onyx133/PoolamKoo](https://github.com/onyx133/PoolamKoo));
- third-party services and other software on the shared host;
- missing hardening that has no demonstrated impact (for example, theoretical header preferences).

## Supported versions

Only the latest commit on `main` is supported.

## Design notes relevant to reporters

The server holds no accounts, credentials, SMS content, amounts or contact details. The data it does keep is listed in [docs/privacy.md](docs/privacy.md). Rule packs are signed offline with an Ed25519 key that never reaches the server; the server only verifies. If you believe that property can be violated, that is the most valuable kind of report.
