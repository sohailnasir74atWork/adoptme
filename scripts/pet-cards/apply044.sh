#!/usr/bin/env bash
#
# Apply supabase/044_pet_cards_fusion.sql (Neon fusion: fuse_card)
# to the LINKED Supabase project in one transaction, then list the grants.
#
#   ./scripts/pet-cards/apply044.sh           # apply, then check
#   ./scripts/pet-cards/apply044.sh --check   # read-only grants listing
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/044_pet_cards_fusion.sql"
TOKEN_FILE="$HOME/.supabase/access-token"
REF_FILE="$ROOT/supabase/.temp/project-ref"
[ -s "$TOKEN_FILE" ] || { echo "✖ $TOKEN_FILE is missing." >&2; exit 1; }
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
       || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
       || ' service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text as v
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.proname like 'cards\_%' or p.proname like '\_cards\_%' or p.proname in ('card_catalog_list','open_card_pack','craft_card','get_card_collection','set_card_showcase','fuse_card'))
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
if [ "${1:-}" = "--check" ]; then echo "▸ Live grants on $REF (read-only)"; print_checks; exit 0; fi
echo "▸ Before:"; print_checks
echo "▸ Applying $(basename "$SQL_FILE") to $REF in one transaction"
run_sql "$(printf 'begin;\n%s\ncommit;\n' "$(cat "$SQL_FILE")")" >/dev/null
echo "▸ Applied. After:"; print_checks
