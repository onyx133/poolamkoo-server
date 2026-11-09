# 0009. Deployment on a shared VPS: Docker safe mode behind the host nginx on port 2053

Status: accepted

## Context

The server runs on an existing VPS that hosts other services. Port 443 and the host's nginx already belong to them, and the host owns its firewall rules. A default Docker installation rewrites iptables, creates bridge networks and enables forwarding and masquerade, which can silently change reachability of those other services. The API must be reachable over TLS from Android clients, with no domain purchase required.

## Decision

- Docker runs in "safe mode": `daemon.json` sets `iptables: false`, `ip6tables: false`, `ip-forward: false`, `ip-masq: false` and `bridge: none`. Docker therefore never touches the host's network configuration.
- Without a bridge, every container uses `network_mode: host` and binds to `127.0.0.1` only (`db` on 5433, `api` on 3100). Images are built with `build.network: host`. Nothing is published to the outside; the only public listener is nginx.
- The host's existing nginx terminates TLS for the API on a dedicated port, 2053, in a self-contained server block (`deploy/nginx/poolamkoo-api.conf`), with a Let's Encrypt certificate for `<api-host>` issued by the existing acme.sh setup. A port-80 block serves the ACME challenge and redirects.
- Port 2053 was chosen because 443 is taken and 2053 is one of the HTTPS ports Cloudflare proxies, so moving behind Cloudflare, or to a real domain, later is a DNS change, not a redesign.
- The API container is read-only, drops all capabilities, sets `no-new-privileges` and a 256 MB memory limit.

## Consequences

- No interference with other services; the blast radius of a mistake here is this project's containers and one nginx file.
- No container isolation at the network level: containers share the host network namespace, so any local process can reach `127.0.0.1:5433`. The database relies on its password and the least-privilege role, not on network separation.
- The sslip.io hostname depends on a third-party DNS service; a real domain removes that dependency.
- A non-standard port may be blocked by some networks, notably in Iran. The app is offline-first, and the runbook lists relay options.
- Operations are manual by design (compose commands over SSH); there is no orchestrator.
