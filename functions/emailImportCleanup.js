/**
 * Keeps RTDB email_import/{uid} (the one-time list of Firebase Auth emails,
 * scripts/email-import/import-auth-emails.js) from outliving a player's choice.
 *
 *   pruneEmailImportOnPrefs        any write to email_prefs/{uid} removes the
 *                                  player from email_import. That covers the
 *                                  unsubscribe link (emailUnsubscribe writes
 *                                  optIn:false), Settings → Email updates and
 *                                  the in-app prompt. A "yes" moves them onto
 *                                  the consent list; a "no" takes them off.
 *   pruneEmailImportOnAccountDelete  a deleted account leaves the list too.
 *
 * Whatever sends to email_import must still skip email_prefs optIn === false
 * at send time; these triggers are the cleanup, not the gate.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();

exports.pruneEmailImportOnPrefs = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .database.ref('/email_prefs/{uid}')
  .onWrite(async (change, ctx) => {
    if (!change.after.exists()) return null;
    await admin.database().ref(`email_import/${ctx.params.uid}`).remove();
    return null;
  });

exports.pruneEmailImportOnAccountDelete = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .auth.user()
  .onDelete(async (user) => {
    await admin.database().ref(`email_import/${user.uid}`).remove();
    return null;
  });
