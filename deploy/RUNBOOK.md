# Production runbook

Operator guide for the PoolamKoo API on the shared host. `<api-host>` stands for the public hostname of the API (it is deliberately not written down in this repository). Background: [ADR 0009](../docs/adr/0009-shared-vps-deployment.md).

```
Internet -> nginx :2053 (TLS, <api-host>) -> 127.0.0.1:3100 api -> 127.0.0.1:5433 postgres
```

All commands run on the server from the repository root, with a shorthand:

```sh
dc() { docker compose -f deploy/docker-compose.prod.yml "$@"; }
```

## Rules for a shared host

This host runs other services. Do not:

- edit or remove any nginx file that is not `poolamkoo-*.conf`, or touch another server block;
- change `ufw`/`iptables`/`nftables` rules other than adding the allow rule for TCP 2053 (and 80, if not already open);
- start, stop, restart or prune containers, images or volumes that are not in the `poolamkoo` compose project (no `docker system prune`, no `docker volume prune`);
- change Docker's `daemon.json`. It is deliberately in safe mode (no iptables, no bridge). Restarting the daemon restarts every container on the host.

Always `nginx -t` before `systemctl reload nginx`. Reload, never restart. If `nginx -t` fails, fix or revert your file; do not reload.

## One-time host preparation

1. Pick the API hostname: a name that resolves to the server's IP (a real domain, or a wildcard-DNS name derived from the IP). Keep it in a shell variable for the commands below: `export API_HOST=<api-host>`.
2. Directories and certificate:

   ```sh
   sudo install -d -m 755 /var/www/poolamkoo-acme
   sudo install -d -m 750 /etc/poolamkoo/tls
   ```

3. Install the port-80 block first (it serves the ACME challenge), then issue the certificate. The nginx files carry a `__API_HOST__` placeholder; render it while copying (never commit the rendered files):

   ```sh
   sed "s/__API_HOST__/$API_HOST/g" deploy/nginx/poolamkoo-http.conf \
     | sudo tee /etc/nginx/conf.d/poolamkoo-http.conf >/dev/null
   sudo nginx -t && sudo systemctl reload nginx
   acme.sh --issue -d "$API_HOST" -w /var/www/poolamkoo-acme
   acme.sh --install-cert -d "$API_HOST" \
     --key-file       /etc/poolamkoo/tls/privkey.pem \
     --fullchain-file /etc/poolamkoo/tls/fullchain.pem \
     --reloadcmd      "nginx -t && systemctl reload nginx"
   ```

   The `--reloadcmd` is stored and re-run by the acme.sh cron job on every renewal.

4. Install the API block and open the port:

   ```sh
   sed "s/__API_HOST__/$API_HOST/g" deploy/nginx/poolamkoo-api.conf \
     | sudo tee /etc/nginx/conf.d/poolamkoo-api.conf >/dev/null
   sudo nginx -t && sudo systemctl reload nginx
   sudo ufw allow 2053/tcp comment 'poolamkoo api'
   ```

   Until the API containers are up, nginx answers 502, which is expected. The API block also defines the outer rate limit (`limit_req_zone poolamkoo_api`, 20 requests/s per client, burst 40, then `429`).

## First deploy

```sh
git clone https://github.com/onyx133/poolamkoo-server.git && cd poolamkoo-server
cp deploy/.env.prod.example deploy/.env && chmod 600 deploy/.env
$EDITOR deploy/.env     # generate every secret as the comments describe
dc up -d --build
dc ps
curl -s http://127.0.0.1:3100/v1/health
curl -s "https://$API_HOST:2053/v1/health"
```

What happens: `db` initialises its volume (bootstrap superuser `poolamkoo_admin`; TCP always requires a password, only the in-container unix socket is trusted) and `deploy/db-init/01-app-role.sh` creates the non-superuser roles `poolamkoo_owner` and `poolamkoo_app`; `migrate` applies the SQL migrations as `poolamkoo_owner` and exits; `api` starts once `migrate` has completed. Builds use the host network (`build.network: host`) because the daemon has no bridge.

Load the initial data. `GET /v1/profile/bands` and `GET /v1/catalog` return `404` until it exists. The runtime image carries the starter files under `/app/seed` (read-only), so the first deploy needs no file copy:

```sh
dc run --rm api node dist/cli/bands-import.js seed/bands.json
dc run --rm api node dist/cli/catalog-import.js seed/catalog-seed.json
```

Later versions are published the same way with a new file (see "Operator CLIs"). The production images do not carry the TypeScript seed tooling (`tsx`), so `prisma db seed` is a development-time command.

## Moving an existing database to the hardened roles

The first version of this stack made the superuser `poolamkoo_owner` the migrator and left `trust` on the loopback addresses, so any local process could connect without a password. That user is the cluster's bootstrap superuser and cannot be demoted, and `POSTGRES_INITDB_ARGS` and `deploy/db-init` only act on a fresh volume, so such a deployment is rebuilt on a new volume and its data copied across (the data set is tiny). `docker volume rm` below names the project's own volume; never use `prune`.

```sh
# 1. Before `git pull`, while the OLD compose file and deploy/.env are in place: dump, then stop.
dc exec -T db sh -c 'pg_dump -p 5433 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > old.dump
dc down
# 2. Put the NEW variables in deploy/.env (POSTGRES_PASSWORD, OWNER_DB_PASSWORD, APP_DB_PASSWORD).
docker volume rm poolamkoo_pgdata
dc up -d --build    # fresh volume: roles, pg_hba and migrations as described under "First deploy"
# 3. Copy the data back (not _prisma_migrations: migrate has just created it).
dc exec -T db pg_restore -p 5433 -U poolamkoo_admin -d poolamkoo --data-only --no-owner \
  -t installs -t profiles -t band_tables -t offers -t icons -t categories -t merchants \
  -t catalog_releases -t rule_packs < old.dump
# 4. Verify: this must fail with "no password supplied".
dc exec db psql -h 127.0.0.1 -p 5433 -U poolamkoo_admin -d poolamkoo -w -c 'SELECT 1'
```

Skipping step 3 is also fine: re-import the content with the CLIs, and apps re-register on their next sync (opt-in profiles would need to be granted again).

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

Script names are in `package.json` (`bands:import`, `catalog:import`, `rulepack:import`, `offers:import`, `installs:prune`, `rulepack:keygen`, `rulepack:sign`). In the image each one is `node dist/cli/<name>.js` with the same arguments (`bands-import`, `catalog-import`, `rulepack-import`, `offers-import`, `installs-prune`).

### Income bands

```sh
scp bands.json server:/tmp/poolamkoo-data/
dc run --rm -v /tmp/poolamkoo-data:/data:ro api node dist/cli/bands-import.js /data/bands.json
```

Validates the file (ascending limits, only the last band unbounded) and inserts it as a new `band_tables` version, which must be greater than the current one. `GET /v1/profile/bands` serves the newest version immediately.

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

The private key lives outside the repository (`*.pem` is gitignored anyway), ideally on an encrypted volume with an offline backup. The import verifies the signature against `RULEPACK_PUBLIC_KEY`, requires `version` to exceed the stored maximum and stores the bytes verbatim. Verify afterwards: `curl -si "https://$API_HOST:2053/v1/rule-packs/latest?app_version=999999"` shows `X-Rule-Pack-Version` and `X-Signature`.

Key rotation: see the plan in [threat-model.md](../docs/threat-model.md#rule-pack-key-compromise-and-rotation).

### Offers

```sh
scp offers.json server:/tmp/poolamkoo-data/
dc run --rm -v /tmp/poolamkoo-data:/data:ro api node dist/cli/offers-import.js /data/offers.json
```

Replaces the whole offer set in one transaction. Offers must use `https` URLs and valid band keys.

### Dormant installs

The API deletes installs that have not been seen for `INSTALL_RETENTION_DAYS` (default 180) days once a day. To run it by hand, or with another period:

```sh
dc run --rm api node dist/cli/installs-prune.js --days 90
```

Delete `/tmp/poolamkoo-data` when finished.

## Backups

```sh
dc exec -T db sh -c 'pg_dump -p 5433 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > poolamkoo-$(date +%F).dump
```

The commands use the container-local unix socket (no `-h`): that is the only trusted connection to the database. Run daily from cron and keep a few weeks, off the host. The data is low value (anonymous hashes, coarse bands, reproducible catalog) but rule packs and the catalog history are worth keeping: the signed packs are also in your release repo.

Restore into an empty database: `dc exec -T db pg_restore -p 5433 -U poolamkoo_admin -d poolamkoo --no-owner --role=poolamkoo_owner < file.dump` (objects end up owned by `poolamkoo_owner`; the default privileges from `deploy/db-init/01-app-role.sh` then grant the app role its DML rights, so re-run the `GRANT`s from that script only if they are missing). Test a restore occasionally.

## Rotating secrets

| Secret                | Effect of rotating                                                                                                                                                                                                                                                                                                                                                                 | How                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`          | All access tokens become invalid. Apps get `401` and re-register on their next sync (no data loss, no user action).                                                                                                                                                                                                                                                                | Edit `deploy/.env`, `dc up -d`.                                                                                                             |
| `SERVER_PEPPER`       | **Every install hash changes.** Existing rows can never be matched again: apps re-register as new installs, old rows (and their opt-in profiles) become orphans that nobody can erase, and users must re-consent to offers. Do this only after a suspected pepper leak, and then also run `TRUNCATE installs CASCADE` (`dc exec db psql -p 5433 -U poolamkoo_admin -d poolamkoo`). | Edit, `dc up -d`, truncate.                                                                                                                 |
| `APP_DB_PASSWORD`     | API cannot connect until both sides agree.                                                                                                                                                                                                                                                                                                                                         | `dc exec db psql -p 5433 -U poolamkoo_admin -d poolamkoo -c "ALTER ROLE poolamkoo_app PASSWORD '...'"`, edit `deploy/.env`, `dc up -d api`. |
| `OWNER_DB_PASSWORD`   | Used by `migrate` (role `poolamkoo_owner`, not a superuser).                                                                                                                                                                                                                                                                                                                       | `ALTER ROLE poolamkoo_owner PASSWORD ...` as above, edit `.env`.                                                                            |
| `POSTGRES_PASSWORD`   | Password of the bootstrap superuser `poolamkoo_admin`. It is only used over the unix socket (which needs no password), so the value matters only if someone reaches it through TCP.                                                                                                                                                                                                | `ALTER ROLE poolamkoo_admin PASSWORD ...` as above, edit `.env`.                                                                            |
| `RULEPACK_PUBLIC_KEY` | Imports verify against the new key; already-stored packs are untouched. The app must ship the new public key first.                                                                                                                                                                                                                                                                | See threat model.                                                                                                                           |

Generate with `openssl rand -base64 48` (or `-hex 24` for DB passwords).

## Certificate renewal

acme.sh renews from cron and runs the stored reload hook (`nginx -t && systemctl reload nginx`). Check: `acme.sh --list` and `echo | openssl s_client -connect "$API_HOST:2053" -servername "$API_HOST" 2>/dev/null | openssl x509 -noout -dates`. Renewal needs port 80 reachable and `poolamkoo-http.conf` intact.

## Troubleshooting

| Symptom                                           | Check                                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `502` from nginx                                  | `dc ps`; `dc logs api`. The API listens on 127.0.0.1:3100 only.                                                                                            |
| `api` exits at start with "Invalid configuration" | The log lists the offending variables (`SERVER_PEPPER`/`JWT_SECRET` need >= 32 bytes; `RULEPACK_PUBLIC_KEY` must be a 32-byte key in base64).              |
| `migrate` fails                                   | `dc logs migrate`. Connection errors: is `db` healthy and listening on 5433 (`ss -ltn                                                                      | grep 5433`)? |
| `permission denied for table` in api logs         | Role grants missing. `db-init` only runs on first volume init; apply its SQL by hand as `poolamkoo_admin` (over the socket).                               |
| `429` from nginx (no `request_id` in the body)    | The outer `limit_req` (20 requests/s per client, burst 40) fired. Raise `rate=`/`burst=` in the rendered `poolamkoo-api.conf` only if real clients hit it. |
| `429` for real users                              | Many users behind one carrier NAT IP. Raise `RATE_LIMIT_MAX`. Check that `X-Forwarded-For` is set by nginx (otherwise everyone shares one key).            |
| Build cannot reach npm                            | The build must use `network: host`; confirm it is set and the host has outbound DNS.                                                                       |
| `nginx -t` fails on `listen ... http2`            | nginx >= 1.25.1 prefers `http2 on;`; 1.24 requires the form used here.                                                                                     |
| Container name or port clash                      | Another service owns the port. 3100 and 5433 were chosen to avoid existing ones; pick others in the compose file, nginx conf and `.env`.                   |

Logs: `dc logs -f api` (JSON, no IPs or bodies). nginx keeps no access log by design.

## Reachability from Iran

A foreign IP on a non-standard port may be filtered or throttled for users in Iran, and filtering varies by ISP and over time. The app is offline-first, so an outage only delays catalog, rule-pack and offer sync; nothing breaks. If reachability becomes a problem:

- Put the API behind Cloudflare with a real domain. Port 2053 is one of Cloudflare's proxied HTTPS ports, so only DNS and the certificate change (the nginx block, the compose stack and the app's base URL setting stay as they are). Use an origin certificate or keep Let's Encrypt with DNS-01.
- Or front it with an Iranian relay/CDN such as ArvanCloud, which also removes the foreign-IP signal.
- Either way the app needs a new base URL in a release, and old releases keep using the previous host until they update; keep it alive during the transition.
