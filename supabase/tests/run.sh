#!/usr/bin/env bash
# Applies all migrations to a fresh local database and runs the SQL test suite.
# Usage: PGHOST=/tmp PGPORT=54329 supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGUSER=${PGUSER:-postgres}
DB=ialc_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d $DB -f "$1"; }
run supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do run "$f"; done
if [ -f tests/fixtures/stv_39126_jahra_to_hawally.pdf ]; then
  npx vite-node scripts/gen-sql-fixtures.ts >/dev/null   # builds 10_fixtures.sql from the real sample files
  for f in supabase/tests/[1-9]*.sql; do echo "== $f"; run "$f"; done
else
  echo "Sample STV/plan files not in tests/fixtures (they are not committed) - scenario tests skipped."
fi
echo "ALL SQL TESTS PASSED"
