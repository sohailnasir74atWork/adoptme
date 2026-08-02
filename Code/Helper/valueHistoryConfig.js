/**
 * valueHistoryConfig.js
 *
 * Endpoints for the value-history CDN, kept separate from the helper so the
 * base URL is trivial to point at a staging zone without touching cache logic.
 *
 * Published by the `elvebredd_bunny` pipeline. Storage zone `adoptme-history`
 * (Frankfurt), pull zone `adoptme-history`. Every file is served with
 * `cache-control: max-age=2592000`, so a republish needs a cache purge to reach
 * clients — see the pipeline README §4.
 *
 * Note this is a different zone from the app's main catalog (adoptme.b-cdn.net,
 * fetched in GlobelStats.js). The two are separate upstream feeds; see the
 * join-key comment in valueHistoryHelper.js before assuming their ids relate.
 */

export const HISTORY_CDN_BASE = 'https://adoptme-history.b-cdn.net';

export const CATALOG_URL = `${HISTORY_CDN_BASE}/values.json`;
export const MANIFEST_URL = `${HISTORY_CDN_BASE}/manifest.json`;

export const historyUrl = (historyKey) =>
  `${HISTORY_CDN_BASE}/history/${encodeURIComponent(historyKey)}.json`;
