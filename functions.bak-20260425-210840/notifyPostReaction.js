/**
 * Cloud Function: Send push notifications when someone reacts to a post
 *
 * This function triggers when a designPost document is updated.
 * It detects new reactions by diffing the before/after reactions map.
 * It sends push notifications to:
 * 1. The post creator — "Someone reacted to your post"
 * 2. Previous commenters — "Someone reacted on a post you commented on"
 * 3. Previous reactors/likers — "Someone reacted on a post you liked"
 *
 * Deployment:
 * firebase deploy --only functions:notifyPostReaction
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyPostReaction = functions.firestore
  .document('designPosts/{postId}')
  .onUpdate(async (change, context) => {
    const { postId } = context.params;
    const before = change.before.data();
    const after = change.after.data();

    // ── Detect new reaction by diffing reactions map ──
    const reactionsBefore = before.reactions || {};
    const reactionsAfter = after.reactions || {};

    // Find the user who just added or changed a reaction
    let reactorId = null;
    let reactorEmoji = null;

    for (const uid of Object.keys(reactionsAfter)) {
      if (!reactionsBefore[uid] || reactionsBefore[uid] !== reactionsAfter[uid]) {
        reactorId = uid;
        reactorEmoji = reactionsAfter[uid];
        break;
      }
    }

    // If no new reaction found (could be a removal or other field update), skip
    if (!reactorId || !reactorEmoji) {
      return null;
    }

    console.log(`🔥 Post reaction notification triggered: postId=${postId}, reactor=${reactorId}, emoji=${reactorEmoji}`);

    const postData = after;
    const postCreatorId = postData.userId;
    const postDescription = postData.desc || postData.description || 'a post';
    const shortDescription = postDescription.length > 50
      ? postDescription.substring(0, 50) + '...'
      : postDescription;

    // Get reactor display name from RTDB
    let reactorName = 'Someone';
    try {
      const nameSnap = await admin.database().ref(`/users/${reactorId}/displayName`).once('value');
      if (nameSnap.val()) {
        reactorName = nameSnap.val();
      }
    } catch (e) {
      console.warn('Could not fetch reactor name:', e);
    }

    try {
      // ── Collect all users to notify ──

      // 1. Post creator (if not the reactor)
      const allUserIds = new Set();
      if (postCreatorId && postCreatorId !== reactorId) {
        allUserIds.add(postCreatorId);
      }

      // 2. Previous reactors (from reactions map, excluding the new reactor)
      for (const uid of Object.keys(reactionsAfter)) {
        if (uid !== reactorId) {
          allUserIds.add(uid);
        }
      }

      // 3. Previous likers (from likes map, excluding the new reactor)
      if (postData.likes && typeof postData.likes === 'object') {
        for (const uid of Object.keys(postData.likes)) {
          if (uid !== reactorId) {
            allUserIds.add(uid);
          }
        }
      }

      // 4. Previous commenters (limit reads for cost)
      const MAX_COMMENTS_TO_CHECK = 100;
      const commentsSnapshot = await admin.firestore()
        .collection(`designPosts/${postId}/comments`)
        .orderBy('createdAt', 'desc')
        .limit(MAX_COMMENTS_TO_CHECK)
        .get();

      const commenterIds = new Set();
      commentsSnapshot.forEach((doc) => {
        const comment = doc.data();
        if (comment.userId && comment.userId !== reactorId) {
          commenterIds.add(comment.userId);
          allUserIds.add(comment.userId);
        }
      });

      // Cap at 50 recipients
      const MAX_USERS_TO_NOTIFY = 50;
      const userIdsArray = Array.from(allUserIds).slice(0, MAX_USERS_TO_NOTIFY);

      if (userIdsArray.length === 0) {
        console.log('ℹ️ No users to notify for reaction.');
        return null;
      }

      console.log(`📋 Notifying ${userIdsArray.length} users about reaction on post ${postId}`);

      // ── Batch fetch FCM tokens and preferences ──
      const userDataPromises = userIdsArray.map(userId =>
        Promise.all([
          admin.database().ref(`/users/${userId}/fcmToken`).once('value'),
          admin.database().ref(`/users/${userId}/notificationSettings`).once('value'),
        ]).then(([fcmTokenSnap, prefsSnap]) => ({
          userId,
          fcmToken: fcmTokenSnap.val(),
          prefs: prefsSnap.val() || {},
        }))
      );

      const userDataArray = await Promise.all(userDataPromises);

      // ── Send notifications ──
      const notificationPromises = [];

      for (const userData of userDataArray) {
        const { userId, fcmToken, prefs } = userData;

        if (!fcmToken) {
          console.log(`⚠️ Missing FCM token for user: ${userId}`);
          continue;
        }

        // Check user's notification preferences
        if (prefs.postReactionNotifications === false) {
          console.log(`User ${userId} has disabled post reaction notifications`);
          continue;
        }

        // Determine message based on user's relationship to the post
        const isCreator = userId === postCreatorId;
        const isCommenter = commenterIds.has(userId);

        let notificationTitle;
        let notificationBody;
        let role;

        if (isCreator) {
          role = 'creator';
          notificationTitle = 'New Reaction on Your Post';
          notificationBody = `${reactorName} reacted ${reactorEmoji} to your post: "${shortDescription}"`;
        } else if (isCommenter) {
          role = 'commenter';
          notificationTitle = 'New Reaction on Post';
          notificationBody = `${reactorName} reacted ${reactorEmoji} on a post you commented on: "${shortDescription}"`;
        } else {
          // Liker or previous reactor
          role = 'liker';
          notificationTitle = 'New Reaction on Post You Liked';
          notificationBody = `${reactorName} reacted ${reactorEmoji} on a post you liked: "${shortDescription}"`;
        }

        console.log(`📡 Preparing notification for user ${userId} (${role})`);

        const payload = {
          notification: {
            title: notificationTitle,
            body: notificationBody,
          },
          data: {
            type: 'postReaction',
            postId: postId || '',
            reactorId: reactorId || '',
            senderId: reactorId || '',
            reactorName: reactorName || '',
            emoji: reactorEmoji || '',
            timestamp: Date.now().toString(),
          },
          token: fcmToken,
          android: {
            priority: 'high',
            notification: {
              channelId: 'default',
              sound: 'default',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              },
            },
          },
        };

        notificationPromises.push(
          admin.messaging().send(payload)
            .then(() => {
              console.log(`✅ Reaction notification sent to ${userId} (${role})`);
            })
            .catch((error) => {
              console.error(`❌ Failed to send reaction notification to ${userId}:`, error);

              // Remove invalid tokens
              if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                console.log(`Removing invalid token for user ${userId}`);
                admin.database().ref(`/users/${userId}/fcmToken`).remove();
              }
            })
        );
      }

      await Promise.all(notificationPromises);
      console.log(`✅ Completed sending reaction notifications for post ${postId}`);

    } catch (error) {
      console.error('❌ Error in notifyPostReaction:', error);
    }

    return null;
  });
