#!/usr/bin/env node
/**
 * One-time backfill: populate /notifier_index/{mode}/{itemKey}/{userId} = true
 * for every subscription that exists in /notifier/{mode}/{userId}/{itemKey}
 * but is missing its index entry.
 *
 * Idempotent — safe to re-run.
 *
 * Run: node scripts/backfill-notifier-index.js [--dry-run]
 */

const fs = require('fs');
const os = require('os');
const https = require('https');

const PROJECT = 'adoptme-7b50c';
const DB = 'adoptme-7b50c-default-rtdb';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

const FB_LIB = '/opt/homebrew/lib/node_modules/firebase-tools/lib';
const cfg = JSON.parse(fs.readFileSync(os.homedir() + '/.config/configstore/firebase-tools.json'));
const refreshToken = cfg.tokens?.refresh_token;
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

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ host: u.host, path: u.pathname + u.search }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${d.slice(0, 300)}`));
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    }).on('error', reject);
  });
}

function patchJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({ host: u.host, path: u.pathname + u.search, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${d.slice(0, 500)}`));
        resolve(d);
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function main() {
  console.log('Refreshing access token...');
  const tok = await postForm('oauth2.googleapis.com', '/token',
    `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`);
  const accessToken = tok.access_token;
  if (!accessToken) { console.error('Auth failed:', tok); process.exit(1); }

  let totalToWrite = 0;
  const writePlans = {}; // mode -> array of {itemKey, userId}

  for (const mode of ['buy', 'sale']) {
    console.log(`\n=== Diffing ${mode} ===`);
    const [notifier, index] = await Promise.all([
      getJson(`https://${DB}.firebaseio.com/notifier/${mode}.json?access_token=${accessToken}`),
      getJson(`https://${DB}.firebaseio.com/notifier_index/${mode}.json?access_token=${accessToken}`),
    ]);

    const indexed = new Set();
    for (const itemKey in (index || {})) {
      for (const userId in (index[itemKey] || {})) {
        indexed.add(`${userId}|${itemKey}`);
      }
    }

    const missing = [];
    for (const userId in (notifier || {})) {
      for (const itemKey in (notifier[userId] || {})) {
        if (!indexed.has(`${userId}|${itemKey}`)) {
          missing.push({ itemKey, userId });
        }
      }
    }

    console.log(`Missing index entries to add for ${mode}: ${missing.length}`);
    writePlans[mode] = missing;
    totalToWrite += missing.length;
  }

  console.log(`\nTotal entries to write: ${totalToWrite}`);
  if (totalToWrite === 0) { console.log('Nothing to do.'); return; }

  if (DRY_RUN) { console.log('\n--dry-run set; no writes performed.'); return; }

  // Apply
  for (const mode of ['buy', 'sale']) {
    const missing = writePlans[mode];
    if (!missing.length) continue;
    console.log(`\nWriting ${missing.length} entries to /notifier_index/${mode} ...`);

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const chunk = missing.slice(i, i + BATCH_SIZE);
      const update = {};
      for (const { itemKey, userId } of chunk) {
        update[`${itemKey}/${userId}`] = true;
      }
      await patchJson(`https://${DB}.firebaseio.com/notifier_index/${mode}.json?access_token=${accessToken}`, update);
      process.stdout.write(`  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missing.length / BATCH_SIZE)} (${chunk.length} entries) ✔\n`);
    }
  }

  console.log('\nBackfill complete. Re-run scripts/check-notifier-index.js to verify.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
