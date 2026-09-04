// Cloud Functions entry point — adoptme-7b50c.
//
// 2026-09-04: this repo is now the single deploy source. Every export below is
// a function that was live in production (verified against `gcloud functions
// list` and 30 days of Cloud Monitoring invocation counts); each module is the
// same source the deployed archive contained (recovered 2026-09-02) plus the
// cosmetics-compare fix in mirrorUsersToSupabase.
//
// Deliberately NOT exported (0 invocations in 30 days — manual HTTPS triggers):
//   fetchWorldCupDataNow, updateLeaderboardCacheManual
// Deploying this codebase with `--only functions` never deletes a live function
// that is missing here; delete those two explicitly:
//   firebase functions:delete fetchWorldCupDataNow updateLeaderboardCacheManual --project adoptme-7b50c
//
// Repo modules that are NOT deployed (legacy, kept for reference only):
//   mirrorChatMetaToRtdb, mirrorChatMetaToSupabase, mirrorPrivateMessageToRtdb,
//   mirrorPrivateMessageToSupabase, notifyGroupMessageLegacy,
//   notifyNewMessageLegacy, sendDeprecationCountdown, sendUpdateNoticeMessage,
//   syncBadgeRoster, *.local.js
//
// Deploy:  firebase deploy --only functions --project adoptme-7b50c
// One:     firebase deploy --only functions:mirrorUsersToSupabase --project adoptme-7b50c

// ── RTDB → Supabase mirrors ────────────────────────────────────────────
exports.mirrorUsersToSupabase = require('./mirrorUsersToSupabase').mirrorUsersToSupabase;
exports.mirrorGroupMetaToSupabase = require('./mirrorGroupMetaToSupabase').mirrorGroupMetaToSupabase;

// ── Supabase auth bridge ───────────────────────────────────────────────
exports.setSupabaseRoleClaim = require('./setSupabaseRoleClaim').setSupabaseRoleClaim;

// ── Push notifications ─────────────────────────────────────────────────
exports.notifyNewMessage = require('./notifyNewMessage').notifyNewMessage;
exports.notifyGroupMessage = require('./notifyGroupMessage').notifyGroupMessage;
exports.notifyGroupInvitation = require('./notifyGroupInvitation').notifyGroupInvitation;
exports.notifyGroupJoinRequest = require('./notifyGroupJoinRequest').notifyGroupJoinRequest;
exports.notifyFromTrade = require('./notifyFromTrade').notifyFromTrade;
exports.notifyTradeAccept = require('./notifyTradeAccept').notifyTradeAccept;
exports.notifyPostComment = require('./notifyPostComment').notifyPostComment;
exports.notifyPostReaction = require('./notifyPostReaction').notifyPostReaction;

// ── Scheduled maintenance ──────────────────────────────────────────────
exports.cleanupExpiredStatuses = require('./cleanupExpiredStatuses').cleanupExpiredStatuses;
exports.cleanupGroupChatMessages = require('./cleanupGroupChatMessages').cleanupGroupChatMessages;
exports.cleanupGroups = require('./cleanupGroups').cleanupGroups;
exports.cleanupOldPosts = require('./cleanupOldPosts').cleanupOldPosts;
exports.cleanupOldPrivateChats = require('./cleanupOldPrivateChats').cleanupOldPrivateChats;
exports.cleanupOldPublicChats = require('./cleanupOldPublicChats').cleanupOldPublicChats;
exports.cleanupOldTrades = require('./cleanupOldTrades').cleanupOldTrades;
exports.clearPresenceNode = require('./clearPresenceNode').clearPresenceNode;
exports.scheduledFunction = require('./scheduledFunction').scheduledFunction;
exports.sendScheduledPromoMessageMM2 = require('./sendScheduledPromoMessageMM2').sendScheduledPromoMessageMM2;

// ── Feeds, leaderboards, analytics ────────────────────────────────────
exports.computeFeedRanking = require('./computeFeedRanking').computeFeedRanking;
exports.aggregateTradeAnalytics = require('./aggregateTradeAnalytics').aggregateTradeAnalytics;
exports.updateLeaderboardCache = require('./updateLeaderboardCache').updateLeaderboardCache;
exports.updateTrustedTraders = require('./updateTrustedTraders').updateTrustedTraders; // v2
exports.valueAlertsPoll = require('./valueAlertsPoll').valueAlertsPoll;                // v2

// ── Roles mirror safety net (6-hourly RTDB ⇄ Supabase user_roles diff) ─
exports.reconcileRolesMirror = require('./reconcileRolesMirror').reconcileRolesMirror;

// ── Mod / badge rosters ───────────────────────────────────────────────
const modRoles = require('./syncModRole_Moderator');
exports.syncModRole_Moderator = modRoles.syncModRole_Moderator;
exports.syncModRole_BabyMod = modRoles.syncModRole_BabyMod;
exports.seedModRoster = require('./syncModRoster').seedModRoster;
const rosters = require('./syncRosterMaintenance');
exports.refreshAllRosters = rosters.refreshAllRosters;
exports.seedAllRosters = rosters.seedAllRosters;

// ── World Cup 2026 ────────────────────────────────────────────────────
const worldCup = require('./fetchWorldCupData');
exports.fetchWorldCupDataScheduled = worldCup.fetchWorldCupDataScheduled;
exports.updateWorldCupLeaderboard = worldCup.updateWorldCupLeaderboard;
