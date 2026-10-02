#!/usr/bin/env bash
#
# Apply supabase/042_art_cmsr.sql (Art CMSR column) to the LINKED Supabase
# project in one transaction through the Management API, then print checks.
#
#   ./scripts/role-badges/apply042.sh           # apply, then check
#   ./scripts/role-badges/apply042.sh --check   # read-only checks only
#
# Needs: ~/.supabase/access-token and supabase/.temp/project-ref (same files
# scripts/staff-elections/apply041.sh uses). Idempotent: the migration uses
# IF NOT EXISTS and the transaction rolls back as a whole on any error.
#
# Order for the CMSR split (CMSR_SPLIT_HANDOFF_2026-10-03.md):
#   1. this script
#   2. npx firebase deploy --only database --project adoptme-7b50c
#   3. ./functions-deploy/deploy.sh mirrorUsersToSupabase reconcileRolesMirror
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/042_art_cmsr.sql"
TOKEN_FILE="$HOME/.supabase/access-token"
REF_FILE="$ROOT/supabase/.temp/project-ref"

[ -s "$TOKEN_FILE" ] || { echo "✖ $TOKEN_FILE is missing. Create a personal access token at https://supabase.com/dashboard/account/tokens and save it there." >&2; exit 1; }
[ -s "$REF_FILE" ]   || { echo "✖ $REF_FILE is missing (project not linked)." >&2; exit 1; }
[ -s "$SQL_FILE" ]   || { echo "✖ $SQL_FILE not found." >&2; exit 1; }

REF="$(tr -d '[:space:]' < "$REF_FILE")"
TOK="$(tr -d '[:space:]' < "$TOKEN_FILE")"
API="https://api.supabase.com/v1/projects/$REF/database/query"

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
select 'is_art_cmsr column (want 1)' as k, count(*)::text as v
  from information_schema.columns
 where table_schema = 'public' and table_name = 'user_roles' and column_name = 'is_art_cmsr'
union all
select 'idx_user_roles_art_cmsr (want 1)', count(*)::text
  from pg_indexes where tablename = 'user_roles' and indexname = 'idx_user_roles_art_cmsr'
union all
select 'user_roles rows', count(*)::text from public.user_roles
union all
select 'house CMSR holders (is_cmsr)', count(*)::text from public.user_roles where is_cmsr
union all
select 'art CMSR holders (is_art_cmsr)',
       coalesce((select count(*)::text from public.user_roles
                  where to_jsonb(user_roles) ? 'is_art_cmsr'
                    and (to_jsonb(user_roles)->>'is_art_cmsr')::boolean), 'n/a (column missing)')
SQL
)

PRINT_PY=$(cat <<'PY'
import json, sys
d = json.load(sys.stdin)
if not isinstance(d, list):
    print(d); sys.exit(1)
for r in d:
    print(f"  {r['k']:36s} {r['v']}")
PY
)

print_checks() { run_sql "$CHECKS" | python3 -c "$PRINT_PY"; }

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
echo "Next: npx firebase deploy --only database --project adoptme-7b50c"
echo "Then: ./functions-deploy/deploy.sh mirrorUsersToSupabase reconcileRolesMirror"
