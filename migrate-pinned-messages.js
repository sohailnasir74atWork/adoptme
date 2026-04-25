#!/usr/bin/env node
/**
 * Migration script: Firebase pinned messages → Supabase
 *
 * Usage:
 *   node migrate-pinned-messages.js
 *
 * Fetches all pinned messages from Firebase RTDB and inserts them into Supabase.
 */

const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

// ────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────

// Firebase config (update with your credentials)
const firebaseConfig = {
  projectId: 'adoptme-7b50c',
  databaseURL: 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
  // Add other credentials if needed
};

// Supabase config
const supabaseUrl = 'https://kvtbtzhtcaanhjblyick.supabase.co';
const supabaseKey = 'sb_publishable_jS-BfPZ_e1WnhDaJYhU8LQ_wd3ipadn';

// Map Firebase chat paths to Supabase room IDs
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

// ────────────────────────────────────────────────────────────
// Initialize clients
// ────────────────────────────────────────────────────────────

// Initialize Firebase
admin.initializeApp({
  ...firebaseConfig,
  credential: admin.credential.applicationDefault(),
});

const db = admin.database();
const supabase = createClient(supabaseUrl, supabaseKey);

// ────────────────────────────────────────────────────────────
// Migration logic
// ────────────────────────────────────────────────────────────

async function migratePinnedMessages() {
  console.log('🚀 Starting pinned messages migration...\n');

  try {
    let totalMigrated = 0;
    let totalSkipped = 0;

    for (const [fbPath, roomId] of Object.entries(ROOM_ID_MAP)) {
      console.log(`📍 Processing room: ${fbPath} → ${roomId}`);

      // Fetch pinned messages from Firebase
      const fbSnapshot = await db.ref(`pinned_messages/${fbPath}`).get();
      if (!fbSnapshot.exists()) {
        console.log(`   ⏭️  No pinned messages found in Firebase for ${fbPath}\n`);
        continue;
      }

      const pinnedData = fbSnapshot.val();
      const messageIds = Object.keys(pinnedData);
      console.log(`   Found ${messageIds.length} pinned messages`);

      // For each pinned message
      for (const fbMessageId of messageIds) {
        try {
          const pinData = pinnedData[fbMessageId];

          // Try to find the message in Supabase by the Firebase message ID
          const { data: sbMessage, error: selectErr } = await supabase
            .from('messages')
            .select('id')
            .or(`id.eq.${fbMessageId},id.eq.${fbMessageId.toString()}`)
            .single();

          if (selectErr || !sbMessage) {
            console.log(`   ⚠️  Message ${fbMessageId} not found in Supabase (might be deleted)`);
            totalSkipped++;
            continue;
          }

          // Check if already pinned in Supabase
          const { data: existing } = await supabase
            .from('pinned_messages')
            .select('id')
            .eq('room_id', roomId)
            .eq('message_id', sbMessage.id)
            .single();

          if (existing) {
            console.log(`   ✓ Message ${fbMessageId} already pinned in Supabase`);
            totalSkipped++;
            continue;
          }

          // Insert into Supabase
          const { error: insertErr } = await supabase
            .from('pinned_messages')
            .insert({
              room_id: roomId,
              message_id: sbMessage.id,
              pinned_by: pinData.pinnedBy || 'migration',
              pinned_at: pinData.pinnedAt ? new Date(pinData.pinnedAt).toISOString() : new Date().toISOString(),
            });

          if (insertErr) {
            console.log(`   ❌ Failed to insert pinned message ${fbMessageId}: ${insertErr.message}`);
            totalSkipped++;
          } else {
            console.log(`   ✓ Pinned message ${fbMessageId} migrated`);
            totalMigrated++;
          }
        } catch (error) {
          console.log(`   ❌ Error processing message ${fbMessageId}:`, error.message);
          totalSkipped++;
        }
      }

      console.log('');
    }

    // Summary
    console.log('✅ Migration complete!');
    console.log(`   Total migrated: ${totalMigrated}`);
    console.log(`   Total skipped/failed: ${totalSkipped}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    admin.app().delete();
  }
}

// ────────────────────────────────────────────────────────────
// Run migration
// ────────────────────────────────────────────────────────────

migratePinnedMessages().then(() => {
  console.log('\n✨ Done!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
