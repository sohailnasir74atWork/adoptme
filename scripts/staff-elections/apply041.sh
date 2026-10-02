#!/usr/bin/env bash
#
# Apply supabase/041_staff_admin_final.sql to the LINKED Supabase project in
# one transaction through the Management API, then print the post-checks.
#
#   ./scripts/staff-elections/apply041.sh           # apply, then check
#   ./scripts/staff-elections/apply041.sh --check   # read-only checks only
#
# Needs: ~/.supabase/access-token (a personal access token, the same file the
# earlier migrations used) and supabase/.temp/project-ref (the linked project,
# kvtbtzhtcaanhjblyick). Safe to re-run: the migration is idempotent and the
# transaction rolls back as a whole on any error.
#
# Order of operations for the admin-final-say change:
#   1. this script            (new RPCs appear; staff_mark_applied is dropped)
#   2. ./functions-deploy/deploy.sh runStaffElections
#   3. optional: gcloud scheduler jobs run firebase-schedule-runStaffElections-us-central1 \
#                  --location us-central1 --project adoptme-7b50c
#      then: firebase functions:log --project adoptme-7b50c --only runStaffElections
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/041_staff_admin_final.sql"
TOKEN_FILE="$HOME/.supabase/access-token"
REF_FILE="$ROOT/supabase/.temp/project-ref"

[ -s "$TOKEN_FILE" ] || { echo "✖ $TOKEN_FILE is missing. Create a personal access token at https://supabase.com/dashboard/account/tokens and save it there." >&2; exit 1; }
[ -s "$REF_FILE" ]   || { echo "✖ $REF_FILE is missing (project not linked)." >&2; exit 1; }
[ -s "$SQL_FILE" ]   || { echo "✖ $SQL_FILE not found." >&2; exit 1; }

REF="$(tr -d '[:space:]' < "$REF_FILE")"
TOK="$(tr -d '[:space:]' < "$TOKEN_FILE")"
API="https://api.supabase.com/v1/projects/$REF/database/query"

# Run one SQL text; prints the JSON result; exits non-zero on a non-2xx reply.
run_sql() {
  local body out code
  body="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$1")"
  out="$(curl -s -w $'\n%{http_code}' -X POST "$API" \
          -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
          --data-binary "$body")"
  code="$(printf '%s\n' "$out" | tail -n1)"
  printf '%s\n' "$out" | sed '$d'
  case "$code" in 2*) return 0 ;; *) echo "✖ HTTP $code" >&2; return 1 ;; esac
}

CHECKS=$(cat <<'SQL'
select 'functions' as k, string_agg(proname, ', ' order by proname) as v
  from pg_proc where pronamespace = 'public'::regnamespace
   and (proname like 'staff%' or proname in ('_staff_result', '_staff_holds', '_staff_phase'))
union all
select 'staff_mark_applied (must be 0)', count(*)::text from pg_proc where proname = 'staff_mark_applied'
union all
select 'status_check', pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.staff_elections'::regclass and conname = 'staff_elections_status_check'
union all
select 'indexes', string_agg(indexname, ', ' order by indexname) from pg_indexes
 where tablename in ('staff_elections', 'staff_decisions')
union all
select 'staff_decisions columns', coalesce(string_agg(column_name, ', ' order by ordinal_position), '(table missing)')
  from information_schema.columns where table_schema = 'public' and table_name = 'staff_decisions'
union all
select 'new columns', coalesce(string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name), '(none)')
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'staff_elections' and column_name in ('counted_at', 'decided_by'))
     or (table_name = 'staff_candidates' and column_name in ('votes', 'qualified')))
union all
select 'rls staff_decisions', coalesce((select relrowsecurity::text from pg_class where relname = 'staff_decisions'), '(table missing)')
union all
select 'rows', (select count(*) from staff_elections)::text || ' elections, ' || (select count(*) from staff_candidates)::text || ' candidates, ' || (select count(*) from staff_votes)::text || ' votes, ' || (select count(*) from staff_terms)::text || ' terms'
union all
select 'grant ' || p.proname || ' → ' || r.rolname, has_function_privilege(r.rolname, p.oid, 'execute')::text
  from pg_proc p cross join pg_roles r
 where p.pronamespace = 'public'::regnamespace
   and r.rolname in ('anon', 'authenticated', 'service_role')
   and p.proname in ('staff_admin_results', 'staff_admin_decide', 'staff_admin_finish',
                     'staff_pending_apply', 'staff_decision_applied', 'staff_decision_notified',
                     'staff_terms_open', 'staff_finalize', 'staff_due', '_staff_result', '_staff_holds')
SQL
)

PRINT_PY=$(cat <<'PY'
import json, sys
d = json.load(sys.stdin)
if not isinstance(d, list):
    print(d); sys.exit(1)
for r in d:
    print(f"  {r['k']:42s} {r['v']}")
PY
)

print_checks() {
  run_sql "$CHECKS" | python3 -c "$PRINT_PY"
}

if [ "${1:-}" = "--check" ]; then
  echo "▸ Live checks on $REF (read-only)"
  print_checks
  exit 0
fi

echo "▸ Applying $(basename "$SQL_FILE") to $REF in one transaction"
run_sql "$(printf 'begin;\n%s\ncommit;\n' "$(cat "$SQL_FILE")")" >/dev/null
echo "▸ Applied. Post-checks:"
print_checks
echo
echo "Expected: staff_admin_results / staff_admin_decide / staff_admin_finish → authenticated true, anon false;"
echo "          staff_pending_apply / staff_decision_* / staff_terms_open / staff_finalize / staff_due → service_role true only;"
echo "          status_check lists open, counted, finalized, cancelled; indexes include staff_elections_one_live, not staff_elections_one_open."
echo
echo "Next: ./functions-deploy/deploy.sh runStaffElections"
