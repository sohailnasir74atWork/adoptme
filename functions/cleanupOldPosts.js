/**
 * Cloud Function: Cleanup old feed posts + Bunny CDN images (older than 7 days)
 *
 * Runs daily at 6:00 AM UTC. Deletes old posts from Firestore `designPosts`,
 * their comments subcollection, and associated images from Bunny CDN storage.
 *
 * What gets deleted:
 * - Firestore: designPosts/{postId} documents
 * - Firestore: designPosts/{postId}/comments/* subcollection
 * - Bunny CDN: image files referenced in post.imageUrl array
 *
 * Cost optimization:
 * - Queries only old docs using createdAt index
 * - Deletes Firestore docs in batches of 500
 * - Deletes Bunny CDN files via HTTP DELETE (no extra SDK needed)
 * - Comments deleted in sub-batches per post
 *
 * Deployment:
 * firebase deploy --only functions:cleanupOldPosts
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const https = require('https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

// Bunny CDN config (same as client UploadModal.js)
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

/**
 * Delete a file from Bunny CDN storage via HTTP DELETE.
 * Extracts the storage path from the CDN URL.
 */
function deleteBunnyFile(cdnUrl) {
  return new Promise((resolve) => {
    // Extract path from CDN URL: https://pull-gag.b-cdn.net/uploads/userId/file.jpg → uploads/userId/file.jpg
    let storagePath;
    try {
      if (cdnUrl.startsWith(BUNNY_CDN_BASE)) {
        storagePath = cdnUrl.replace(`${BUNNY_CDN_BASE}/`, '');
      } else {
        // Try to extract path after the domain
        const url = new URL(cdnUrl);
        storagePath = url.pathname.replace(/^\//, '');
      }
    } catch (e) {
      console.warn(`⚠️ Could not parse URL: ${cdnUrl}`);
      resolve(false);
      return;
    }

    const options = {
      hostname: BUNNY_STORAGE_HOST,
      path: `/${BUNNY_STORAGE_ZONE}/${storagePath}`,
      method: 'DELETE',
      headers: {
        'AccessKey': BUNNY_ACCESS_KEY,
      },
    };

    const req = https.request(options, (res) => {
      // 200/201 = deleted, 404 = already gone — both are fine
      resolve(res.statusCode < 400 || res.statusCode === 404);
      res.resume(); // drain response
    });

    req.on('error', (err) => {
      console.warn(`⚠️ Bunny delete failed for ${storagePath}:`, err.message);
      resolve(false);
    });

    req.end();
  });
}

/**
 * Delete all documents in a subcollection (comments) in batches.
 */
async function deleteSubcollection(firestore, postId) {
  const commentsRef = firestore.collection(`designPosts/${postId}/comments`);
  let deleted = 0;

  while (true) {
    const snapshot = await commentsRef.limit(BATCH_SIZE).get();
    if (snapshot.empty) break;

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < BATCH_SIZE) break;
  }

  return deleted;
}

exports.cleanupOldPosts = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 06:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - SEVEN_DAYS_MS);
    const firestore = admin.firestore();
    let totalPostsDeleted = 0;
    let totalCommentsDeleted = 0;
    let totalImagesDeleted = 0;

    console.log(`🧹 Starting post cleanup. Cutoff: ${cutoff.toDate().toISOString()}`);

    try {
      let hasMore = true;

      while (hasMore) {
        const snapshot = await firestore.collection('designPosts')
          .where('createdAt', '<', cutoff)
          .limit(BATCH_SIZE)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        // Process each post: delete images + comments, then the post itself
        const postBatch = firestore.batch();

        for (const doc of snapshot.docs) {
          const post = doc.data();

          // 1. Delete images from Bunny CDN
          if (Array.isArray(post.imageUrl) && post.imageUrl.length > 0) {
            const deletePromises = post.imageUrl.map((url) => deleteBunnyFile(url));
            const results = await Promise.all(deletePromises);
            totalImagesDeleted += results.filter(Boolean).length;
          }

          // 2. Delete comments subcollection
          const commentsDeleted = await deleteSubcollection(firestore, doc.id);
          totalCommentsDeleted += commentsDeleted;

          // 3. Queue post document for batch delete
          postBatch.delete(doc.ref);
        }

        // 4. Commit post deletions
        await postBatch.commit();
        totalPostsDeleted += snapshot.size;

        console.log(`🗑️ Batch: ${snapshot.size} posts, images cleaned, comments removed`);

        if (snapshot.size < BATCH_SIZE) {
          hasMore = false;
        }
      }

    } catch (error) {
      console.error('❌ Error in cleanupOldPosts:', error);
    }

    console.log(`🧹 Post cleanup complete. Posts: ${totalPostsDeleted}, Comments: ${totalCommentsDeleted}, Images: ${totalImagesDeleted}`);
    return null;
  });
