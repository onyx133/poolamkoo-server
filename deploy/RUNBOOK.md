# Production runbook

Operator guide for the PoolamKoo API on the shared VPS. Background: [ADR 0009](../docs/adr/0009-shared-vps-deployment.md).

```
Internet -> nginx :2053 (TLS, <api-host>) -> 127.0.0.1:3100 api -> 127.0.0.1:5433 postgres
```

All commands run on the server from the repository root, with a shorthand:

```sh
dc() { docker compose -f deploy/docker-compose.prod.yml "$@"; }
```

## Rules for a shared host

This VPS runs other people's services. Do not:

- edit or remove any nginx file that is not `poolamkoo-*.conf`, or touch another server block;
- change `ufw`/`iptables`/`nftables` rules other than adding the allow rule for TCP 2053 (and 80, if not already open);
- start, stop, restart or prune containers, images or volumes that are not in the `poolamkoo` compose project (no `docker system prune`, no `docker volume prune`);
- change Docker's `daemon.json`. It is deliberately in safe mode (no iptables, no bridge). Restarting the daemon restarts every container on the host.

Always `nginx -t` before `systemctl reload nginx`. Reload, never restart. If `nginx -t` fails, fix or revert your file; do not reload.

## One-time host preparation

1. DNS needs nothing: `<api-host>` resolves to the server's IP.
2. Directories and certificate:

   ```sh
   sudo install -d -m 755 /var/www/poolamkoo-acme
   sudo install -d -m 750 /etc/poolamkoo/tls
   ```

3. Install the port-80 block first (it serves the ACME challenge), then issue the certificate:

   ```sh
   sudo cp deploy/nginx/poolamkoo-http.conf /etc/nginx/conf.d/
   sudo nginx -t && sudo systemctl reload nginx
   acme.sh --issue -d <api-host> -w /var/www/poolamkoo-acme
   acme.sh --install-cert -d <api-host> \
     --key-file       /etc/poolamkoo/tls/privkey.pem \
     --fullchain-file /etc/poolamkoo/tls/fullchain.pem \
     --reloadcmd      "nginx -t && systemctl reload nginx"
   ```

   The `--reloadcmd` is stored and re-run by the acme.sh cron job on every renewal.

4. Install the API block and open the port:

   ```sh
   sudo cp deploy/nginx/poolamkoo-api.conf /etc/nginx/conf.d/
   sudo nginx -t && sudo systemctl reload nginx
   sudo ufw allow 2053/tcp comment 'poolamkoo api'
   ```

   Until the API containers are up, nginx answers 502, which is expected.

## First deploy

```sh
git clone https://github.com/onyx133/poolamkoo-server.git && cd poolamkoo-server
cp deploy/.env.prod.example deploy/.env && chmod 600 deploy/.env
$EDITOR deploy/.env     # generate every secret as the comments describe
dc up -d --build
dc ps
curl -s http://127.0.0.1:3100/v1/health
curl -s https://<api-host>:2053/v1/health
```

What happens: `db` initialises its volume and `deploy/db-init/01-app-role.sh` creates `poolamkoo_app`; `migrate` applies the SQL migrations as the owner and exits; `api` starts once `migrate` has completed. Builds use the host network (`build.network: host`) because the daemon has no bridge.

Load the initial data. `GET /v1/profile/bands` and `GET /v1/catalog` return `404` until it exists.

```sh
# Income bands (same values as seed/bands.json; the table is versioned, the latest version is served)
dc exec -T db sh -c 'psql -h 127.0.0.1 -p 5433 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO band_tables (version, currency, bands) VALUES
  (1, 'IRR', '[{"key":"B1","max_monthly_net_income":150000000},{"key":"B2","max_monthly_net_income":300000000},{"key":"B3","max_monthly_net_income":600000000},{"key":"B4","max_monthly_net_income":1200000000},{"key":"B5","max_monthly_net_income":null}]')
ON CONFLICT (version) DO NOTHING;
SQL
```

Then import the catalog as described under "Operator CLIs". The production images do not carry the TypeScript seed tooling (`tsx`), so `prisma db seed` is a development-time command; production data goes in through the CLIs and the SQL above. Check the column names against `prisma/schema.prisma` if the schema has changed.

## Updating

```sh
git pull --ff-only
dc build                 # api + migrate images
dc up -d                 # re-runs migrate (one-shot), then recreates api if the image changed
dc ps && dc logs --tail 50 api
```

Migrations are forward-only SQL files. Deploys that include a migration cause no downtime unless the migration locks tables for long; the schema is small, so none do today. The API is restarted by `up -d` (a second or two of 502 from nginx; the app retries and is offline-first).

Rollback: `git checkout <previous-tag>`, `dc build`, `dc up -d`. If a migration was applied, write a new forward migration instead of reverting data by hand.

## Operator CLIs

The CLIs ship in the runtime image under `dist/cli/`. Run them as one-off containers with the input directory mounted read-only. They connect as `poolamkoo_app` (DML is enough for imports).

Script names are in `package.json` (`catalog:import`, `rulepack:import`, `offers:import`, `rulepack:keygen`, `rulepack:sign`).

### Catalog

```sh
scp catalog-seed.json server:/tmp/poolamkoo-data/
dc run --rm -v /tmp/poolamkoo-data:/data:ro api node dist/cli/catalog-import.js /data/catalog-seed.json
```

Validates the file, refuses to drop existing keys unless `--allow-removals` is added, and requires a `version` greater than the current release. A new `catalog_releases` row is written and the API serves it within 30 seconds (cache re-check).

### Rule packs

Signing happens on the release machine, never on this server.

```sh
# release machine, once
npm run build && npm run rulepack:keygen -- --out ~/secure/poolamkoo-rulepack.pem
# -> prints the base64 public key; put it in deploy/.env as RULEPACK_PUBLIC_KEY, then `dc up -d`

# release machine, per release
npm run rulepack:sign -- pack.json --key ~/secure/poolamkoo-rulepack.pem     # writes pack.json.sig
scp pack.json pack.json.sig server:/tmp/poolamkoo-data/

# server
dc run --rm -v /tmp/poolamkoo-data:/data:ro api \
  node dist/cli/rulepack-import.js /data/pack.json /data/pack.json.sig
```

The private key lives outside the repository (`*.pem` is gitignored anyway), ideally on an encrypted volume with an offline backup. The import verifies the signature against `RULEPACK_PUBLIC_KEY`, requires `version` to exceed the stored maximum and stores the bytes verbatim. Verify afterwards: `curl -si 'https://<api-host>:2053/v1/rule-packs/latest?app_version=999999'` shows `X-Rule-Pack-Version` and `X-Signature`.

Key rotation: see the plan in [threat-model.md](../docs/threat-model.md#rule-pack-key-compromise-and-rotation).

### Offers

```sh
scp offers.json server:/tmp/poolamkoo-data/
dc run --rm -v /tmp/poolamkoo-data:/data:ro api node dist/cli/offers-import.js /data/offers.json
```

Replaces the whole offer set in one transaction. Offers must use `https` URLs and valid band keys.

Delete `/tmp/poolamkoo-data` when finished.

## Backups

```sh
dc exec -T db sh -c 'pg_dump -h 127.0.0.1 -p 5433 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > poolamkoo-$(date +%F).dump
```

Run daily from cron and keep a few weeks, off the host. The data is low value (anonymous hashes, coarse bands, reproducible catalog) but rule packs and the catalog history are worth keeping: the signed packs are also in your release repo.

Restore into an empty database: `dc exec -T db pg_restore -h 127.0.0.1 -p 5433 -U poolamkoo_owner -d poolamkoo --no-owner < file.dump`, then re-run `GRANT`s as in `deploy/db-init/01-app-role.sh` if the roles were not preserved. Test a restore occasionally.

## Rotating secrets

| Secret                    | Effect of rotating                                                                                                                                                                                                                                                                                                                  | How                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`              | All access tokens become invalid. Apps get `401` and re-register on their next sync (no data loss, no user action).                                                                                                                                                                                                                 | Edit `deploy/.env`, `dc up -d`.                                                                                                                          |
| `SERVER_PEPPER`           | **Every install hash changes.** Existing rows can never be matched again: apps re-register as new installs, old rows (and their opt-in profiles) become orphans that nobody can erase, and users must re-consent to offers. Do this only after a suspected pepper leak, and then also run `TRUNCATE installs CASCADE` as the owner. | Edit, `dc up -d`, truncate.                                                                                                                              |
| `APP_DB_PASSWORD`         | API cannot connect until both sides agree.                                                                                                                                                                                                                                                                                          | `dc exec db psql -h 127.0.0.1 -p 5433 -U poolamkoo_owner -d poolamkoo -c "ALTER ROLE poolamkoo_app PASSWORD '...'"`, edit `deploy/.env`, `dc up -d api`. |
| `POSTGRES_OWNER_PASSWORD` | Used by `migrate` and admin shells.                                                                                                                                                                                                                                                                                                 | `ALTER ROLE` as above, edit `.env`.                                                                                                                      |
| `RULEPACK_PUBLIC_KEY`     | Imports verify against the new key; already-stored packs are untouched. The app must ship the new public key first.                                                                                                                                                                                                                 | See threat model.                                                                                                                                        |

Generate with `openssl rand -base64 48` (or `-hex 24` for DB passwords).

## Certificate renewal

acme.sh renews from cron and runs the stored reload hook (`nginx -t && systemctl reload nginx`). Check: `acme.sh --list` and `echo | openssl s_client -connect <api-host>:2053 -servername <api-host> 2>/dev/null | openssl x509 -noout -dates`. Renewal needs port 80 reachable and `poolamkoo-http.conf` intact.

## Troubleshooting

| Symptom                                           | Check                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `502` from nginx                                  | `dc ps`; `dc logs api`. The API listens on 127.0.0.1:3100 only.                                                                                 |
| `api` exits at start with "Invalid configuration" | The log lists the offending variables (`SERVER_PEPPER`/`JWT_SECRET` need >= 32 bytes; `RULEPACK_PUBLIC_KEY` must be a 32-byte key in base64).   |
| `migrate` fails                                   | `dc logs migrate`. Connection errors: is `db` healthy and listening on 5433 (`ss -ltn                                                           | grep 5433`)? |
| `permission denied for table` in api logs         | Role grants missing. `db-init` only runs on first volume init; apply its SQL by hand as the owner.                                              |
| `429` for real users                              | Many users behind one carrier NAT IP. Raise `RATE_LIMIT_MAX`. Check that `X-Forwarded-For` is set by nginx (otherwise everyone shares one key). |
| Build cannot reach npm                            | The build must use `network: host`; confirm it is set and the host has outbound DNS.                                                            |
| `nginx -t` fails on `listen ... http2`            | nginx >= 1.25.1 prefers `http2 on;`; 1.24 requires the form used here.                                                                          |
| Container name or port clash                      | Another service owns the port. 3100 and 5433 were chosen to avoid existing ones; pick others in the compose file, nginx conf and `.env`.        |

Logs: `dc logs -f api` (JSON, no IPs or bodies). nginx keeps no access log by design.

## Reachability from Iran

A foreign IP on a non-standard port may be filtered or throttled for users in Iran, and filtering varies by ISP and over time. The app is offline-first, so an outage only delays catalog, rule-pack and offer sync; nothing breaks. If reachability becomes a problem:

- Put the API behind Cloudflare with a real domain. Port 2053 is one of Cloudflare's proxied HTTPS ports, so only DNS and the certificate change (the nginx block, the compose stack and the app's base URL setting stay as they are). Use an origin certificate or keep Let's Encrypt with DNS-01.
- Or front it with an Iranian relay/CDN such as ArvanCloud, which also removes the foreign-IP signal.
- Either way the app needs a new base URL in a release, and old releases keep using the sslip.io host until they update; keep it alive during the transition.
