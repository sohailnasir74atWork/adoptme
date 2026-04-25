#!/usr/bin/env node
/**
 * Transform Firebase pinned messages JSON → Supabase SQL INSERT statements
 *
 * Usage:
 *   node transform-pinned.js <firebase-export.json> <output.sql>
 */

const fs = require('fs');

const ROOM_ID_MAP = {
  'chat_new': 'public:en',
  'chat_es': 'public:es',
  'chat_pt': 'public:pt',
  'chat_fr': 'public:fr',
  'chat_de': 'public:de',
  'chat_tr': 'public:tr',
  'chat_ar': 'public:ar',
  'chat_ja': 'public:ja',
  'chat_ko': 'public:ko',
  'chat_ru': 'public:ru',
};

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'insert-pinned.sql';

if (!inputFile) {
  console.error('❌ Usage: node transform-pinned.js <firebase-export.json> [output.sql]');
  process.exit(1);
}

try {
  console.log(`📖 Reading Firebase export: ${inputFile}`);
  const firebaseData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  let sqlInserts = [];
  let totalCount = 0;

  // Process each room's pinned messages
  const pinnedMessages = firebaseData.pinned_messages || {};

  for (const [fbPath, messages] of Object.entries(pinnedMessages)) {
    const roomId = ROOM_ID_MAP[fbPath];
    if (!roomId) {
      console.log(`⚠️  Skipping unknown room: ${fbPath}`);
      continue;
    }

    console.log(`\n📍 Processing ${fbPath} → ${roomId}`);

    if (!messages || typeof messages !== 'object') {
      console.log(`   No messages found`);
      continue;
    }

    for (const [messageId, pinData] of Object.entries(messages)) {
      const pinnedBy = pinData.pinnedBy || 'migration';
      const pinnedAt = pinData.pinnedAt
        ? new Date(pinData.pinnedAt).toISOString()
        : new Date().toISOString();

      const sql = `INSERT INTO pinned_messages (room_id, message_id, pinned_by, pinned_at) VALUES ('${roomId}', '${messageId}', '${pinnedBy}', '${pinnedAt}') ON CONFLICT DO NOTHING;`;

      sqlInserts.push(sql);
      totalCount++;
      console.log(`   ✓ ${messageId}`);
    }
  }

  // Write SQL file
  const sqlContent = [
    '-- Pinned messages migration from Firebase',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total inserts: ${totalCount}`,
    '-- Run this in Supabase SQL Editor',
    '',
    ...sqlInserts,
  ].join('\n');

  fs.writeFileSync(outputFile, sqlContent);
  console.log(`\n✅ Generated ${outputFile} with ${totalCount} INSERT statements`);
  console.log('\n📋 Next steps:');
  console.log(`1. Open Supabase Dashboard → SQL Editor`);
  console.log(`2. Copy & paste the contents of ${outputFile}`);
  console.log(`3. Click "Run"`);

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
