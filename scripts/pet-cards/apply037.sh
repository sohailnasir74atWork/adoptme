#!/usr/bin/env bash
#
# Apply supabase/037_pet_cards.sql (Pet Cards tables, RPCs, launch packs) to
# the LINKED Supabase project in one transaction through the Management API,
# then print checks.
#
#   ./scripts/pet-cards/apply037.sh           # apply, then check
#   ./scripts/pet-cards/apply037.sh --check   # read-only checks only
#
# Needs: ~/.supabase/access-token and supabase/.temp/project-ref (same files
# apply041.sh / apply042.sh use). Idempotent (IF NOT EXISTS, ON CONFLICT); the
# transaction rolls back as a whole on any error. Re-run
# `node scripts/pet-cards/test037.mjs` first if the SQL changed (56/56 on
# 2026-10-03).
#
# Order (PET_CARDS_PLAN.md §10):
#   1. this script
#   2. ./scripts/pet-cards/sync-catalog.sh            (dry run; expect ~785 rows)
#      ./scripts/pet-cards/sync-catalog.sh --apply
#   3. ./scripts/pet-cards/apply037.sh --check        (packs open? catalog filled?)
# The app needs no change: the Home card shows itself once a pack has cards.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/037_pet_cards.sql"
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

# Safe before and after: only the catalogue views.
BASIC=$(cat <<'SQL'
select 'card_* tables (want 6)' as k, count(*)::text as v
  from information_schema.tables where table_schema = 'public' and table_name like 'card\_%'
union all
select 'cards_* functions', count(*)::text
  from pg_proc where pronamespace = 'public'::regnamespace and proname like 'cards\_%'
SQL
)

# Only once the tables exist.
DETAIL=$(cat <<'SQL'
select 'packs (id, ends, active)' as k,
       coalesce(string_agg(id || ' ends ' || coalesce(ends_at::date::text, 'never') || case when active then '' else ' INACTIVE' end, '; ' order by sort, id), '(none)') as v
  from public.card_sets where kind = 'pack'
union all
select 'album pages (want 18)', count(*)::text from public.card_sets where kind = 'page'
union all
select 'card_catalog rows (0 until the sync)', count(*)::text from public.card_catalog
union all
select 'catalog hd_ready', coalesce((select count(*)::text from public.card_catalog where hd_ready), 'n/a')
union all
select 'cards_state callable by authenticated',
       coalesce((select has_function_privilege('authenticated', p.oid, 'execute')::text
                   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cards_state' limit 1), 'missing')
union all
select 'cards_* open to anon (want 0)',
       (select count(*)::text from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'cards\_%'
            and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'tables with RLS (want 6)',
       (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname like 'card\_%' and c.relkind = 'r' and c.relrowsecurity)
SQL
)

PRINT_PY=$(cat <<'PY'
import json, sys
d = json.load(sys.stdin)
if not isinstance(d, list):
    print(d); sys.exit(1)
for r in d:
    print(f"  {r['k']:40s} {r['v']}")
PY
)

tables_now() { run_sql "$BASIC" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["v"] if isinstance(d,list) else 0)'; }
print_checks() {
  run_sql "$BASIC" | python3 -c "$PRINT_PY"
  if [ "$(tables_now)" != "0" ]; then run_sql "$DETAIL" | python3 -c "$PRINT_PY"; fi
}

if [ "${1:-}" = "--check" ]; then
  echo "▸ Live checks on $REF (read-only)"
  print_checks
  exit 0
fi

if [ "$(tables_now)" != "0" ]; then
  echo "✖ 037 is already applied on $REF ($(tables_now) card_* tables). Its launch-pack inserts are not"
  echo "  re-runnable, so this script applies it only once. Use --check for the live state." >&2
  exit 1
fi
echo "▸ Before:"
print_checks
echo "▸ Applying $(basename "$SQL_FILE") to $REF in one transaction"
run_sql "$(printf 'begin;\n%s\ncommit;\n' "$(cat "$SQL_FILE")")" >/dev/null
echo "▸ Applied. After:"
print_checks
echo
echo "Next: ./scripts/pet-cards/sync-catalog.sh          (dry run)"
echo "      ./scripts/pet-cards/sync-catalog.sh --apply  (writes card_catalog)"
