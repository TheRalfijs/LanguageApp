#!/usr/bin/env bash
# Runs all migrations + RLS tests against a throwaway local Postgres database.
# Usage: PGHOST=… PGPORT=… PGUSER=postgres scripts/test-db.sh
# (Needs a local Postgres 15+. Does NOT touch your Supabase project.)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="b1_rls_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
run supabase/tests/00_local_stubs.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/tests/rls_test.sql
