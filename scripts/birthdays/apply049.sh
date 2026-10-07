#!/usr/bin/env bash
#
# Apply supabase/049_birthdays.sql (Birthdays) to the LINKED Supabase project
# in one transaction, then check it. Same mechanics as
# scripts/pet-cards/apply048.sh (Management API, ~/.supabase/access-token).
#
#   ./scripts/birthdays/apply049.sh           # apply, then check
#   ./scripts/birthdays/apply049.sh --check   # read-only check
#
# If it says HTTP 401, refresh the token first:  supabase login
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/049_birthdays.sql"
TOKEN_FILE="$HOME/.supabase/access-token"
REF_FILE="$ROOT/supabase/.temp/project-ref"
[ -s "$TOKEN_FILE" ] || { echo "✖ $TOKEN_FILE is missing or empty. Run: supabase login" >&2; exit 1; }
[ -s "$REF_FILE" ]   || { echo "✖ $REF_FILE is missing (project not linked)." >&2; exit 1; }
[ -s "$SQL_FILE" ]   || { echo "✖ $SQL_FILE not found." >&2; exit 1; }
REF="$(tr -d '[:space:]' < "$REF_FILE")"
TOK="$(tr -d '[:space:]' < "$TOKEN_FILE")"
API="https://api.supabase.com/v1/projects/$REF/database/query"
run_sql() {
  local body out code
  body="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$1")"
  out="$(curl -s -w $'\n%{http_code}' -X POST "$API" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data-binary "$body")"
  code="$(printf '%s\n' "$out" | tail -n1)"
  printf '%s\n' "$out" | sed '$d'
  case "$code" in 2*) return 0 ;; *) echo "✖ HTTP $code" >&2; return 1 ;; esac
}
CHECK=$(cat <<'SQL'
select p.proname as k,
       'anon=' || has_function_privilege('anon', p.oid, 'execute')::text
       || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text as v
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.proname like '%birthday%' or p.proname = 'open_card_pack')
 order by p.proname
SQL
)
PRINT_PY=$(cat <<'PY'
import json, sys
d = json.load(sys.stdin)
if not isinstance(d, list):
    print(d); sys.exit(1)
for r in d:
    print(f"  {r['k']:28s} {r['v']}")
print("  anon=true count:", sum(1 for r in d if "anon=true" in r["v"]), "(want 0)")
PY
)
print_checks() { run_sql "$CHECK" | python3 -c "$PRINT_PY"; }
if [ "${1:-}" = "--check" ]; then echo "▸ Live state on $REF (read-only)"; print_checks; exit 0; fi

echo "▸ Applying $(basename "$SQL_FILE") to $REF in one transaction"
run_sql "$(printf 'begin;\n%s\ncommit;\n' "$(cat "$SQL_FILE")")" >/dev/null
echo "▸ Applied. Functions and grants (want authenticated=true on the 5 client RPCs, false on birthday_push_batch):"
print_checks
echo "▸ 049 checks (want tables=4, open_ok=true):"
run_sql "select (select count(*) from information_schema.tables where table_schema='public' and table_name like 'birthday%') tables,
                position('''birthday''' in (select prosrc from pg_proc where proname='open_card_pack' and pronamespace='public'::regnamespace)) > 0 open_ok"
echo
