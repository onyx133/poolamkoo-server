#!/bin/sh
# Runs once, on first start of the postgres container (docker-entrypoint-initdb.d), as the
# bootstrap superuser (POSTGRES_USER) over the container-local unix socket. Creates the two
# roles the application stack uses, neither of which is a superuser:
#
#   poolamkoo_owner  owns the database and the public schema; runs migrations (`migrate`).
#   poolamkoo_app    DML only (SELECT/INSERT/UPDATE/DELETE); the API connects as it.
#
# The superuser itself is only for bootstrap and manual administration (docker exec ... psql
# over the socket); nothing in the stack connects as it over TCP.
# Required env: OWNER_DB_PASSWORD, APP_DB_PASSWORD.
set -eu

: "${OWNER_DB_PASSWORD:?OWNER_DB_PASSWORD must be set}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_password="$OWNER_DB_PASSWORD" -v app_password="$APP_DB_PASSWORD" \
  -v dbname="$POSTGRES_DB" <<'SQL'
CREATE ROLE poolamkoo_owner LOGIN PASSWORD :'owner_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE poolamkoo_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

ALTER DATABASE :"dbname" OWNER TO poolamkoo_owner;
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO poolamkoo_app;

-- The public schema belongs to the owner; nobody else may create objects in it.
ALTER SCHEMA public OWNER TO poolamkoo_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO poolamkoo_app;

-- Tables and sequences the owner creates (migrations) get the app grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE poolamkoo_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO poolamkoo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE poolamkoo_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO poolamkoo_app;
SQL
