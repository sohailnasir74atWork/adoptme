#!/usr/bin/env bash
#
# Run scripts/pet-cards/sync-card-catalog.js against the LIVE project with the
# service-role secrets read from GCP Secret Manager for the call only (never
# printed, never written to disk).
#
#   ./scripts/pet-cards/sync-catalog.sh            # dry run: prints what would change
#   ./scripts/pet-cards/sync-catalog.sh --apply    # writes card_catalog
#
# Needs gcloud signed in with access to project adoptme-7b50c, and 037 applied
# first (./scripts/pet-cards/apply037.sh).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PROJECT="adoptme-7b50c"
SUPABASE_URL="$(gcloud secrets versions access latest --secret=SUPABASE_URL --project "$PROJECT")"
SUPABASE_SERVICE_ROLE_KEY="$(gcloud secrets versions access latest --secret=SUPABASE_SERVICE_ROLE_KEY --project "$PROJECT")"
export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
exec node "$ROOT/scripts/pet-cards/sync-card-catalog.js" "$@"
