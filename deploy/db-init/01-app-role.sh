#!/bin/sh
# Runs once on first start of the postgres container (docker-entrypoint-initdb.d), as the
# owner role (POSTGRES_USER). Creates the least-privilege role the API connects as.
# Required env: APP_DB_PASSWORD. The migrator/owner role creates the tables.
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" -v owner="$POSTGRES_USER" -v dbname="$POSTGRES_DB" <<'SQL'
CREATE ROLE poolamkoo_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO poolamkoo_app;

GRANT USAGE ON SCHEMA public TO poolamkoo_app;

-- Tables that already exist (none on first boot, but harmless).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO poolamkoo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO poolamkoo_app;

-- Tables and sequences the owner creates later (migrations) get the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO poolamkoo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO poolamkoo_app;
SQL
