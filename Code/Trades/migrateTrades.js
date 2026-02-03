/**
 * Migration Script: Add hasItemNames and wantsItemNames to existing trades
 * 
 * Run this once to migrate all existing trades in production.
 * This adds indexed fields to old trades so they can be searched efficiently.
 * 
 * Usage:
 * 1. Import this function in your app
 * 2. Call migrateOldTrades() once (e.g., from admin panel or on app update)
 * 3. Monitor progress via console logs
 */

import { collection, getDocs, updateDoc, doc, query, limit, startAfter, orderBy } from '@react-native-firebase/firestore';

/**
 * Creates search tokens from item name (same logic as HomeScreen.jsx)
 */
const createSearchTokens = (itemName) => {
  const name = itemName.toLowerCase().trim();
  const tokens = [name]; // Full name for exact match
  
  // Split into words and add each word as a token
  const words = name.split(/\s+/).filter(w => w.length > 0);
  tokens.push(...words);
  
  return [...new Set(tokens)]; // Remove duplicates
};

/**
 * Migrates old trades to add hasItemNames and wantsItemNames fields
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Function} onProgress - Callback for progress updates (processed, total)
 * @param {number} batchSize - Number of trades to process at a time (default: 50)
 */
export const migrateOldTrades = async (firestoreDB, onProgress = null, batchSize = 50) => {
  if (!firestoreDB) {
    console.error('❌ Firestore DB not provided');
    return;
  }

  console.log('🔄 Starting trade migration...');
  
  let processedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let lastDoc = null;
  let hasMore = true;

  try {
    while (hasMore) {
      // ✅ Fetch batch of trades
      let tradesQuery = query(
        collection(firestoreDB, 'trades_new'),
        orderBy('timestamp', 'desc'),
        limit(batchSize)
      );

      if (lastDoc) {
        tradesQuery = query(
          collection(firestoreDB, 'trades_new'),
          orderBy('timestamp', 'desc'),
          startAfter(lastDoc),
          limit(batchSize)
        );
      }

      const snapshot = await getDocs(tradesQuery);
      
      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      // ✅ Process each trade
      const updatePromises = [];
      
      snapshot.docs.forEach((docSnap) => {
        const tradeData = docSnap.data();
        
        // ✅ Skip if already migrated (has indexed fields)
        if (tradeData.hasItemNames && tradeData.wantsItemNames) {
          skippedCount++;
          processedCount++;
          return;
        }

        // ✅ Create indexed arrays from hasItems/wantsItems
        const hasItemNames = (tradeData.hasItems || [])
          .filter(item => item && (item.name || item.Name))
          .flatMap(item => createSearchTokens(item.name || item.Name));
        
        const wantsItemNames = (tradeData.wantsItems || [])
          .filter(item => item && (item.name || item.Name))
          .flatMap(item => createSearchTokens(item.name || item.Name));

        // ✅ Update trade with indexed fields
        updatePromises.push(
          updateDoc(doc(firestoreDB, 'trades_new', docSnap.id), {
            hasItemNames,
            wantsItemNames,
          }).then(() => {
            updatedCount++;
            processedCount++;
          }).catch((error) => {
            console.error(`❌ Error updating trade ${docSnap.id}:`, error);
            processedCount++;
          })
        );
      });

      // ✅ Wait for all updates in this batch
      await Promise.all(updatePromises);

      // ✅ Update progress callback
      if (onProgress) {
        onProgress(processedCount, updatedCount, skippedCount);
      }

      console.log(`✅ Processed ${processedCount} trades (Updated: ${updatedCount}, Skipped: ${skippedCount})`);

      // ✅ Update pagination
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.docs.length === batchSize;
    }

    console.log(`✅ Migration complete! Total: ${processedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}`);
    return {
      total: processedCount,
      updated: updatedCount,
      skipped: skippedCount,
    };

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
};

/**
 * Check how many trades need migration
 */
export const checkMigrationStatus = async (firestoreDB, sampleSize = 100) => {
  if (!firestoreDB) {
    console.error('❌ Firestore DB not provided');
    return;
  }

  const snapshot = await getDocs(
    query(
      collection(firestoreDB, 'trades_new'),
      orderBy('timestamp', 'desc'),
      limit(sampleSize)
    )
  );

  let needsMigration = 0;
  let alreadyMigrated = 0;

  snapshot.docs.forEach((docSnap) => {
    const tradeData = docSnap.data();
    if (tradeData.hasItemNames && tradeData.wantsItemNames) {
      alreadyMigrated++;
    } else {
      needsMigration++;
    }
  });

  console.log(`📊 Sample Status (${sampleSize} trades):`);
  console.log(`   ✅ Already migrated: ${alreadyMigrated}`);
  console.log(`   ⚠️  Needs migration: ${needsMigration}`);

  return {
    sampleSize,
    alreadyMigrated,
    needsMigration,
    migrationPercentage: (alreadyMigrated / sampleSize) * 100,
  };
};
