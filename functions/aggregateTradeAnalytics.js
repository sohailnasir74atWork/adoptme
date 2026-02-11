const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const firestore = admin.firestore();

/**
 * aggregateTradeAnalytics
 * 
 * SCHEDULED Cloud Function — runs every 12 hours (NOT on every trade creation).
 * Aggregates analytics from trades_new + reviews collections and stores in Firestore.
 * 
 * After this runs, you manually push the Firestore data to Bunny CDN.
 * The app reads from Bunny CDN (zero Firestore reads from users).
 * 
 * Analytics computed:
 * 1. Top 20 most traded items (24h appearance count)
 * 2. Top 20 most wanted items (demand = trade wants + wishlist data)
 * 3. Top 20 most offered items (supply = trade has + owned pet data)
 * 4. Top 20 wishlisted items (pure wishlist ranking)
 * 5. Top 10 movers (rising demand, week-over-week)
 * 6. Top 10 losers (falling demand, week-over-week)
 * 7. Trade volume stats (today, 24h, week)
 * 8. Win/Lose/Fair distribution (24h)
 * 9. Hourly activity chart (24h)
 * 10. Demand/Supply ratios with signals
 * 11. Predictions with confidence scores
 * 
 * Data stored:
 * - trade_analytics/latest  (single document, fully replaced on every run)
 * 
 * Deployment:
 * firebase deploy --only functions:aggregateTradeAnalytics
 */

// ── Helper: fetch all docs from a query using pagination ──
const fetchAllDocs = async (query, batchSize = 500) => {
  const allDocs = [];
  let lastDoc = null;

  while (true) {
    let q = query.limit(batchSize);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    snap.docs.forEach(d => allDocs.push(d));
    lastDoc = snap.docs[snap.docs.length - 1];

    if (snap.docs.length < batchSize) break; // Last page
  }

  return allDocs;
};

// ── Scheduled function: runs every 12 hours ──
exports.aggregateTradeAnalytics = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('every 12 hours')
  .onRun(async (context) => {
    try {
      const now = Date.now();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // ── Fetch ALL trades from last 7 days (paginated) ──
      const weekTradeDocs = await fetchAllDocs(
        firestore.collection('trades_new')
          .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(oneWeekAgo))
          .orderBy('timestamp', 'desc')
      );

      const weekTrades = weekTradeDocs.map(d => ({ id: d.id, ...d.data() }));

      console.log(`📦 Fetched ${weekTrades.length} trades from last 7 days`);

      // ── Helper: extract timestamp safely ──
      const getTs = (t) => t.timestamp?.toDate ? t.timestamp.toDate() : new Date(t.timestamp);

      // ── Separate time windows ──
      const todayTrades = weekTrades.filter(t => getTs(t) >= todayStart);
      const last24hTrades = weekTrades.filter(t => getTs(t) >= oneDayAgo);

      const midWeek = new Date(now - 3.5 * 24 * 60 * 60 * 1000);
      const firstHalfTrades = weekTrades.filter(t => getTs(t) < midWeek);
      const secondHalfTrades = weekTrades.filter(t => getTs(t) >= midWeek);

      // ── Count item appearances ──
      const countItems = (trades, side) => {
        const counts = {};
        trades.forEach(trade => {
          const items = side === 'has' ? (trade.hasItems || []) : 
                        side === 'wants' ? (trade.wantsItems || []) :
                        [...(trade.hasItems || []), ...(trade.wantsItems || [])];
          items.forEach(item => {
            if (!item?.name) return;
            const key = item.name.toLowerCase().trim();
            if (!counts[key]) {
              counts[key] = {
                name: item.name,
                type: item.type || 'unknown',
                image: item.image || '',
                count: 0,
              };
            }
            counts[key].count++;
          });
        });
        return counts;
      };

      // ── Fetch ALL wishlist & owned pet data from reviews (paginated, no limit) ──
      const wishlistCounts = {};
      const ownedCounts = {};
      let totalWishlistUsers = 0;
      let totalOwnedUsers = 0;

      try {
        const reviewDocs = await fetchAllDocs(
          firestore.collection('reviews')
            .where('updatedAt', '>=', admin.firestore.Timestamp.fromDate(
              new Date(now - 30 * 24 * 60 * 60 * 1000) // last 30 days
            ))
            .orderBy('updatedAt', 'desc')
        );

        reviewDocs.forEach(docSnap => {
          const data = docSnap.data();

          if (Array.isArray(data.wishlistPets) && data.wishlistPets.length > 0) {
            totalWishlistUsers++;
            data.wishlistPets.forEach(pet => {
              const key = (pet.name || pet.Name || '').toLowerCase().trim();
              if (!key) return;
              if (!wishlistCounts[key]) {
                wishlistCounts[key] = {
                  name: pet.name || pet.Name || key,
                  type: pet.category || pet.type || 'unknown',
                  count: 0,
                };
              }
              wishlistCounts[key].count++;
            });
          }

          if (Array.isArray(data.ownedPets) && data.ownedPets.length > 0) {
            totalOwnedUsers++;
            data.ownedPets.forEach(pet => {
              const key = (pet.name || pet.Name || '').toLowerCase().trim();
              if (!key) return;
              if (!ownedCounts[key]) {
                ownedCounts[key] = {
                  name: pet.name || pet.Name || key,
                  type: pet.category || pet.type || 'unknown',
                  count: 0,
                };
              }
              ownedCounts[key].count++;
            });
          }
        });

        console.log(`📊 Reviews: ${reviewDocs.length} docs, ${totalWishlistUsers} wishlist users, ${totalOwnedUsers} owned users`);
      } catch (reviewsError) {
        console.warn('⚠️ Could not fetch reviews data:', reviewsError.message);
      }

      // ── Most traded items (both sides combined, 24h) ──
      const allItemCounts = countItems(last24hTrades, 'all');
      const topTraded = Object.values(allItemCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Most wanted (demand) = trade wants + wishlist (weighted 0.5x) ──
      const wantsCounts24h = countItems(last24hTrades, 'wants');
      Object.keys(wishlistCounts).forEach(key => {
        if (!wantsCounts24h[key]) {
          wantsCounts24h[key] = {
            name: wishlistCounts[key].name,
            type: wishlistCounts[key].type,
            image: '',
            count: 0,
          };
        }
        wantsCounts24h[key].count += Math.round(wishlistCounts[key].count * 0.5);
        wantsCounts24h[key].wishlistCount = wishlistCounts[key].count;
      });
      const topWanted = Object.values(wantsCounts24h)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Most offered (supply) = trade has + owned (weighted 0.5x) ──
      const hasCounts24h = countItems(last24hTrades, 'has');
      Object.keys(ownedCounts).forEach(key => {
        if (!hasCounts24h[key]) {
          hasCounts24h[key] = {
            name: ownedCounts[key].name,
            type: ownedCounts[key].type,
            image: '',
            count: 0,
          };
        }
        hasCounts24h[key].count += Math.round(ownedCounts[key].count * 0.5);
        hasCounts24h[key].ownedCount = ownedCounts[key].count;
      });
      const topOffered = Object.values(hasCounts24h)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Top wishlisted (pure wishlist ranking) ──
      const topWishlisted = Object.values(wishlistCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // ── Demand/Supply ratio (prediction signal) ──
      // Volume-relative: only include items with meaningful activity
      const totalActivity24h = last24hTrades.length || 1;
      const minDSTotal = Math.max(10, Math.round(totalActivity24h * 0.005)); // 0.5% of volume or 10

      const allItemNames = new Set([
        ...Object.keys(wantsCounts24h),
        ...Object.keys(hasCounts24h),
      ]);

      const demandSupplyRatios = [];
      allItemNames.forEach(key => {
        const demand = wantsCounts24h[key]?.count || 0;
        const supply = hasCounts24h[key]?.count || 0;
        const total = demand + supply;
        if (total < minDSTotal) return; // Skip noise items

        const ratio = supply > 0 ? demand / supply : demand > 0 ? Math.min(demand, 10) : 0;
        const volumeShare = ((total / totalActivity24h) * 100); // % of total activity
        demandSupplyRatios.push({
          name: wantsCounts24h[key]?.name || hasCounts24h[key]?.name || key,
          type: wantsCounts24h[key]?.type || hasCounts24h[key]?.type || 'unknown',
          image: wantsCounts24h[key]?.image || hasCounts24h[key]?.image || '',
          demand,
          supply,
          ratio: Math.round(ratio * 100) / 100,
          total,
          volumeShare: Math.round(volumeShare * 10) / 10,
          signal: ratio > 2.0 ? 'rising' : ratio < 0.5 ? 'falling' : 'stable',
        });
      });
      // Sort by ratio but weight by volume share so high-volume items rank higher
      demandSupplyRatios.sort((a, b) => {
        const scoreA = a.ratio * Math.log2(a.total + 1);
        const scoreB = b.ratio * Math.log2(b.total + 1);
        return scoreB - scoreA;
      });

      // ── Trend detection: first half vs second half of week ──
      // Volume-relative: require minimum activity AND both halves must have data
      const firstHalfWants = countItems(firstHalfTrades, 'wants');
      const secondHalfWants = countItems(secondHalfTrades, 'wants');
      const totalWeekActivity = weekTrades.length || 1;
      const minTrendTotal = Math.max(5, Math.round(totalWeekActivity * 0.002)); // 0.2% of week or 5

      const trendItems = [];
      const allTrendKeys = new Set([
        ...Object.keys(firstHalfWants),
        ...Object.keys(secondHalfWants),
      ]);

      allTrendKeys.forEach(key => {
        const before = firstHalfWants[key]?.count || 0;
        const after = secondHalfWants[key]?.count || 0;
        const total = before + after;
        if (total < minTrendTotal) return; // Skip low-activity items
        if (before === 0 && after < 5) return; // Skip items that just appeared with tiny count
        if (after === 0 && before < 5) return; // Skip items that just disappeared with tiny count

        let change;
        if (before === 0) {
          change = Math.min(100, after * 20); // Cap new items at 100%
        } else if (after === 0) {
          change = Math.max(-100, -before * 20); // Cap disappeared items at -100%
        } else {
          change = ((after - before) / before) * 100;
        }
        // Cap extreme percentages at ±500%
        change = Math.max(-500, Math.min(500, change));

        const volumeChange = Math.abs(after - before);

        trendItems.push({
          name: secondHalfWants[key]?.name || firstHalfWants[key]?.name || key,
          type: secondHalfWants[key]?.type || firstHalfWants[key]?.type || 'unknown',
          image: secondHalfWants[key]?.image || firstHalfWants[key]?.image || '',
          before,
          after,
          changePercent: Math.round(change),
          volumeChange,
          direction: change > 25 ? 'up' : change < -25 ? 'down' : 'stable',
        });
      });

      // Sort movers by a balanced score: volume change * log(pct change)
      // This prevents items with 1->13 (tiny volume, huge %) from dominating
      const topMovers = trendItems
        .filter(i => i.direction === 'up')
        .sort((a, b) => {
          const scoreA = a.volumeChange * Math.log2(Math.abs(a.changePercent) + 1);
          const scoreB = b.volumeChange * Math.log2(Math.abs(b.changePercent) + 1);
          return scoreB - scoreA;
        })
        .slice(0, 10);

      const topLosers = trendItems
        .filter(i => i.direction === 'down')
        .sort((a, b) => {
          const scoreA = a.volumeChange * Math.log2(Math.abs(a.changePercent) + 1);
          const scoreB = b.volumeChange * Math.log2(Math.abs(b.changePercent) + 1);
          return scoreB - scoreA;
        })
        .slice(0, 10);

      // ── Trade volume stats ──
      const tradeVolume = {
        today: todayTrades.length,
        last24h: last24hTrades.length,
        thisWeek: weekTrades.length,
      };

      // ── Win/Lose/Fair distribution (24h) ──
      const statusDistribution = {
        win: last24hTrades.filter(t => t.status === 'w').length,
        lose: last24hTrades.filter(t => t.status === 'l').length,
        fair: last24hTrades.filter(t => t.status === 'f').length,
      };

      // ── Hourly trade activity (24h) ──
      const hourlyActivity = new Array(24).fill(0);
      last24hTrades.forEach(trade => {
        const hour = getTs(trade).getHours();
        hourlyActivity[hour]++;
      });

      const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));

      // ── Predictions (demand/supply based, volume-relative) ──
      // Only predict for items with meaningful volume relative to total activity
      const minPredTotal = Math.max(15, Math.round(totalActivity24h * 0.005)); // 0.5% of 24h or 15

      const predictions = demandSupplyRatios
        .filter(item => item.total >= minPredTotal)
        .map(item => {
          // Prediction based on ratio AND volume share
          // High ratio + high volume = strong signal
          // High ratio + low volume = weak signal
          const volWeight = Math.min(1, item.volumeShare / 2); // 0-1 scale, 2% share = max
          const effectiveRatio = item.ratio * (0.5 + volWeight * 0.5); // Dampen ratio for low-volume

          const prediction = effectiveRatio > 3.0 ? 'strong_rise' :
                            effectiveRatio > 1.8 ? 'likely_rise' :
                            effectiveRatio > 0.8 ? 'stable' :
                            effectiveRatio > 0.4 ? 'likely_fall' : 'strong_fall';

          // Confidence based on volume share (more data = more confident)
          const confidence = Math.min(95, Math.round(
            Math.min(item.volumeShare * 15, 60) + // Volume component (max 60)
            Math.min(item.total / 5, 35) // Absolute count component (max 35)
          ));

          return {
            ...item,
            prediction,
            confidence,
          };
        })
        .sort((a, b) => {
          // Sort by confidence * ratio for best predictions first
          const scoreA = a.confidence * a.ratio;
          const scoreB = b.confidence * b.ratio;
          return scoreB - scoreA;
        })
        .slice(0, 20);

      // ── Store in Firestore ──
      // You then push this data to Bunny CDN manually.
      // App reads from CDN = zero Firestore reads from users.
      const analyticsData = {
        topTraded,
        topWanted,
        topOffered,
        topWishlisted,
        topMovers,
        topLosers,
        demandSupplyRatios: demandSupplyRatios.slice(0, 30),
        predictions,
        tradeVolume,
        statusDistribution,
        hourlyActivity,
        peakHour,
        userDataStats: {
          wishlistUsers: totalWishlistUsers,
          ownedUsers: totalOwnedUsers,
          totalReviews: totalWishlistUsers + totalOwnedUsers,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        computedAt: new Date().toISOString(),
      };

      await firestore.collection('trade_analytics').doc('latest').set(analyticsData);

      // ── Cleanup: delete old history_* documents (no longer needed) ──
      try {
        const allDocs = await firestore.collection('trade_analytics').listDocuments();
        const historyDocs = allDocs.filter(d => d.id.startsWith('history_'));
        if (historyDocs.length > 0) {
          const batch = firestore.batch();
          historyDocs.forEach(d => batch.delete(d));
          await batch.commit();
          console.log(`🗑️ Cleaned up ${historyDocs.length} old history documents`);
        }
      } catch (cleanupErr) {
        console.warn('⚠️ Could not cleanup history docs:', cleanupErr.message);
      }

      console.log(`✅ Analytics done: ${weekTrades.length} week trades, ${last24hTrades.length} 24h trades, ${topTraded.length} top items`);
      return null;
    } catch (error) {
      console.error('❌ Error aggregating trade analytics:', error);
      return null;
    }
  });
