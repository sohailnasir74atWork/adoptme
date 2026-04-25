#!/usr/bin/env node
/**
 * Safety check before applying notifyFromTrade.js fix.
 *
 * Compares /notifier/{mode} (current source of truth) vs
 * /notifier_index/{mode}/{itemKey}/{userId} (proposed source of truth).
 *
 * Reports any (user, item) pairs that exist in /notifier but are missing
 * from /notifier_index — those users would silently stop getting alerts
 * if we switch the cloud function to read the index.
 *
 * Run: node scripts/check-notifier-index.js
 */

const fs = require('fs');
const os = require('os');
const https = require('https');

const PROJECT = 'adoptme-7b50c';
const DB = 'adoptme-7b50c-default-rtdb';

// ---- get access token from firebase-tools cache ----
const FB_LIB = '/opt/homebrew/lib/node_modules/firebase-tools/lib';
const cfgPath = os.homedir() + '/.config/configstore/firebase-tools.json';
if (!fs.existsSync(cfgPath)) {
  console.error('No firebase-tools config found. Run `firebase login` first.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath));
const refreshToken = cfg.tokens?.refresh_token;
if (!refreshToken) { console.error('No refresh_token in firebase-tools cache'); process.exit(1); }

const apiSrc = fs.readFileSync(FB_LIB + '/api.js', 'utf8');
const clientId = (apiSrc.match(/FIREBASE_CLIENT_ID"[^"]*"([^"]+)"/) || [])[1];
const clientSecret = (apiSrc.match(/FIREBASE_CLIENT_SECRET"[^"]*"([^"]+)"/) || [])[1];

function postForm(host, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ host: u.host, path: u.pathname + u.search, headers: token ? { Authorization: 'Bearer ' + token } : {} }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${d.slice(0, 300)}`));
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Refreshing access token...');
  const tok = await postForm('oauth2.googleapis.com', '/token',
    `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`);
  if (!tok.access_token) { console.error('Failed to refresh:', tok); process.exit(1); }
  const accessToken = tok.access_token;

  for (const mode of ['buy', 'sale']) {
    console.log(`\n=== Checking /notifier/${mode} vs /notifier_index/${mode} ===`);
    const [notifier, index] = await Promise.all([
      getJson(`https://${DB}.firebaseio.com/notifier/${mode}.json?access_token=${accessToken}`),
      getJson(`https://${DB}.firebaseio.com/notifier_index/${mode}.json?access_token=${accessToken}`),
    ]);

    // Build sets of "userId|itemKey" from each shape
    const fromNotifier = new Set();
    let totalSubs = 0;
    for (const userId in (notifier || {})) {
      for (const itemKey in (notifier[userId] || {})) {
        fromNotifier.add(`${userId}|${itemKey}`);
        totalSubs++;
      }
    }

    const fromIndex = new Set();
    for (const itemKey in (index || {})) {
      for (const userId in (index[itemKey] || {})) {
        fromIndex.add(`${userId}|${itemKey}`);
      }
    }

    const missingFromIndex = [...fromNotifier].filter(x => !fromIndex.has(x));
    const orphanIndex = [...fromIndex].filter(x => !fromNotifier.has(x));

    console.log(`/notifier/${mode}        : ${Object.keys(notifier || {}).length} users, ${totalSubs} subscriptions`);
    console.log(`/notifier_index/${mode}  : ${Object.keys(index || {}).length} items, ${fromIndex.size} subscription mappings`);
    console.log(`Missing from index       : ${missingFromIndex.length}  ← would silently stop getting alerts`);
    console.log(`Orphan in index          : ${orphanIndex.length}  ← stale, would cause bogus matches (low risk)`);

    if (missingFromIndex.length) {
      console.log('\nFirst 10 missing (userId | itemKey):');
      missingFromIndex.slice(0, 10).forEach(x => console.log('  ' + x));
      if (missingFromIndex.length > 10) console.log(`  ... and ${missingFromIndex.length - 10} more`);
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
