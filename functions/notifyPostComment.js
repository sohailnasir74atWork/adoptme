/**
 * Cloud Function: Send push notifications when someone comments on a post
 * 
 * Triggers when a new comment is created in Firestore.
 * Sends push notifications to:
 * 1. The post creator (if they didn't comment themselves)
 * 2. All previous commenters on that post (excluding the new commenter)
 * 3. All users who liked the post (excluding the new commenter)
 * 
 * Deployment:
 * firebase deploy --only functions:notifyPostComment
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyPostComment = functions.firestore
  .document('designPosts/{postId}/comments/{commentId}')
  .onCreate(async (snap, context) => {
    const commentData = snap.data();
    const { postId, commentId } = context.params;
    const newCommenterId = commentData.userId;
    const newCommenterName = commentData.displayName || 'Someone';

    console.log(`💬 Post comment notification triggered: postId=${postId}, commentId=${commentId}`);

    if (!newCommenterId) {
      console.log('⚠️ Missing userId in comment. Skipping...');
      return null;
    }

    try {
      // 1. Get the post data to find the creator
      const postDoc = await admin.firestore().doc(`designPosts/${postId}`).get();
      if (!postDoc.exists) {
        console.log('⚠️ Post not found. Skipping...');
        return null;
      }

      const postData = postDoc.data();
      const postCreatorId = postData.userId;
      const postDescription = postData.desc || postData.description || 'a post';
      const shortDescription = postDescription.length > 50
        ? postDescription.substring(0, 50) + '...'
        : postDescription;

      console.log(`✅ Post found. Creator: ${postCreatorId}, New commenter: ${newCommenterId}`);

      // Early exit: if creator is the new commenter, check if anyone else is involved
      if (postCreatorId === newCommenterId) {
        const hasLikers = postData.likes && typeof postData.likes === 'object'
          && Object.keys(postData.likes).some(uid => uid !== newCommenterId);

        if (!hasLikers) {
          const commentsSnapshot = await admin.firestore()
            .collection(`designPosts/${postId}/comments`)
            .limit(10)
            .get();

          let hasOtherCommenters = false;
          commentsSnapshot.forEach((doc) => {
            if (doc.id !== commentId && doc.data().userId !== newCommenterId) {
              hasOtherCommenters = true;
            }
          });

          if (!hasOtherCommenters) {
            console.log('ℹ️ Only creator has commented, no likers. No one to notify.');
            return null;
          }
        }
      }

      // 2. Get previous comments to find commenters (LIMIT to reduce reads)
      const MAX_COMMENTS_TO_CHECK = 100;
      const commentsSnapshot = await admin.firestore()
        .collection(`designPosts/${postId}/comments`)
        .orderBy('createdAt', 'desc')
        .limit(MAX_COMMENTS_TO_CHECK)
        .get();

      const commenterIds = new Set();
      commentsSnapshot.forEach((doc) => {
        const comment = doc.data();
        if (comment.userId && comment.userId !== newCommenterId && doc.id !== commentId) {
          commenterIds.add(comment.userId);
        }
      });

      // 3. Collect user IDs who liked the post
      const likerIds = new Set();
      if (postData.likes && typeof postData.likes === 'object') {
        Object.keys(postData.likes).forEach((likerId) => {
          if (likerId !== newCommenterId) {
            likerIds.add(likerId);
          }
        });
      }

      console.log(`❤️ Found ${likerIds.size} likers on this post`);

      // Merge all unique user IDs: creator + commenters + likers
      const allUserIds = new Set();

      if (postCreatorId && postCreatorId !== newCommenterId) {
        allUserIds.add(postCreatorId);
      }
      commenterIds.forEach((id) => allUserIds.add(id));
      likerIds.forEach((id) => allUserIds.add(id));

      // Limit notifications to prevent excessive costs
      const MAX_USERS_TO_NOTIFY = 50;
      const userIdsArray = Array.from(allUserIds).slice(0, MAX_USERS_TO_NOTIFY);

      if (userIdsArray.length === 0) {
        console.log('ℹ️ No users to notify.');
        return null;
      }

      console.log(`📋 Found ${commenterIds.size} commenters + ${likerIds.size} likers, notifying ${userIdsArray.length} users`);

      // 4. Batch fetch FCM tokens and preferences
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

      // 5. Send notifications
      const notificationPromises = [];

      for (const userData of userDataArray) {
        const { userId, fcmToken, prefs } = userData;

        if (userId === newCommenterId) continue;

        if (!fcmToken) {
          console.log(`⚠️ Missing FCM token for user: ${userId}`);
          continue;
        }

        // Check user's notification preferences
        if (prefs.postCommentNotifications === false) {
          console.log(`User ${userId} has disabled post comment notifications`);
          continue;
        }

        // Determine notification message based on relationship
        const isCreator = userId === postCreatorId;
        const isCommenter = commenterIds.has(userId);
        const isLiker = likerIds.has(userId);

        let notificationTitle;
        let notificationBody;
        let role;

        if (isCreator) {
          role = 'creator';
          notificationTitle = 'New Comment on Your Post';
          notificationBody = `${newCommenterName} commented on your post: "${shortDescription}"`;
        } else if (isCommenter) {
          role = 'commenter';
          notificationTitle = 'New Comment on Post';
          notificationBody = `${newCommenterName} also commented on "${shortDescription}"`;
        } else if (isLiker) {
          role = 'liker';
          notificationTitle = 'New Comment on Post You Liked';
          notificationBody = `${newCommenterName} commented on a post you liked: "${shortDescription}"`;
        } else {
          continue;
        }

        console.log(`📡 Preparing notification for user ${userId} (${role})`);

        const payload = {
          notification: {
            title: notificationTitle,
            body: notificationBody,
          },
          data: {
            type: 'postComment',
            postId: postId || '',
            commentId: commentId || '',
            commenterId: newCommenterId || '',
            senderId: newCommenterId || '',
            commenterName: newCommenterName || '',
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
              console.log(`✅ Notification sent to ${userId} (${role})`);
            })
            .catch((error) => {
              console.error(`❌ Failed to send notification to ${userId}:`, error);

              // If token is invalid, remove it
              if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                console.log(`Removing invalid token for user ${userId}`);
                admin.database().ref(`/users/${userId}/fcmToken`).remove();
              }
            })
        );
      }

      await Promise.all(notificationPromises);
      console.log(`✅ Completed sending notifications for comment ${commentId} on post ${postId}`);

    } catch (error) {
      console.error('❌ Error in notifyPostComment:', error);
    }

    return null;
  });
