#!/usr/bin/env bash
#
# Apply supabase/056_birthday_short_list.sql (short Birthdays list, Wish
# everyone, Thank everyone, limit 100) to the LINKED Supabase project in one
# transaction, then check it. Same mechanics as apply049.sh (Management API,
# ~/.supabase/access-token). Tested first: node scripts/birthdays/test056.mjs
#
#   ./scripts/birthdays/apply056.sh           # apply, then check
#   ./scripts/birthdays/apply056.sh --check   # read-only check
#
# If it says HTTP 401, refresh the token first:  supabase login
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/056_birthday_short_list.sql"
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
   and p.proname in ('list_birthdays_top', 'wish_all_birthdays', 'thank_birthday_wishers', 'send_birthday_wish',
                     'birthday_home', '_birthday_today_ranked', 'birthday_thanks_push_batch')
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
print("  functions:", len(d), "(want 7)  anon=true:", sum(1 for r in d if "anon=true" in r["v"]), "(want 0)")
PY
)
print_checks() { run_sql "$CHECK" | python3 -c "$PRINT_PY"; }
if [ "${1:-}" = "--check" ]; then echo "▸ Live state on $REF (read-only)"; print_checks; exit 0; fi

echo "▸ Applying $(basename "$SQL_FILE") to $REF in one transaction"
run_sql "$(printf 'begin;\n%s\ncommit;\n' "$(cat "$SQL_FILE")")" >/dev/null
echo "▸ Applied. Want authenticated=true on list_birthdays_top, wish_all_birthdays, thank_birthday_wishers,"
echo "  send_birthday_wish, birthday_home; false on _birthday_today_ranked and birthday_thanks_push_batch:"
print_checks
echo "▸ 056 checks (want thank_cols=2, limit_100=true):"
run_sql "select (select count(*) from information_schema.columns where table_schema='public' and table_name='birthday_wishes'
                  and column_name in ('thanked_at','thank_pushed_at')) thank_cols,
                position('>= 100' in (select prosrc from pg_proc where proname='send_birthday_wish' and pronamespace='public'::regnamespace)) > 0 limit_100"
echo
