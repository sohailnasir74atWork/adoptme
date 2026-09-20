/**
 * modEvidenceUpload.js — screenshots a mod attaches to a ban or mute.
 *
 * 📅 2026-09-19. Pick up to three images, compress them, PUT them to Bunny,
 * hand back the CDN URLs. `mod_actions.evidence_urls` stores the result and
 * the dashboard's Moderation record panel renders it (see 030).
 *
 * ── Where these land, and what that means ────────────────────────────────
 *
 * The same Bunny zone the status feed uploads to (`post-gag`), chosen
 * deliberately to reuse the path that already works. Two consequences, both
 * of which you should know before trusting anything here:
 *
 *   * The write key below is in the app binary and the pull zone is
 *     public-read. Anyone holding the key can read or DELETE what is here.
 *     So: evidence is convenience, not proof. A missing image is not
 *     evidence of tampering, and a present one is not evidence of anything
 *     beyond "someone uploaded it".
 *   * Because it is public-read, remote paths are a bare UUID under
 *     `mod-evidence/` — nothing derived from the target's email, uid or
 *     name, and no date. The feed writes `uploads/<uid>/<timestamp>.jpg`,
 *     which would have made a moderation URL both guessable and
 *     self-describing. A leaked URL here exposes one image and says nothing
 *     about who it concerns.
 *
 * If this ever has to be private, the move is a Supabase bucket with RLS on
 * is_mod_staff() and signed URLs. Only `uploadEvidence` and the viewer's URL
 * resolution change; call sites and the stored column do not.
 *
 * ── Why not import UploadModal's uploader ────────────────────────────────
 *
 * UploadModal's is a useCallback closed over its own component state, so it
 * cannot be called from a drawer or the dashboard. The Bunny constants are
 * duplicated here rather than exported from that file because importing a
 * modal component to get at a string would pull its whole render tree —
 * ads, keyboard wrapper, flash-message — into the dashboard bundle.
 *
 * That does mean the key now appears in one more place. It is already in
 * the binary and already public; the honest fix is rotating it and moving
 * both call sites to a server-signed upload, which is its own piece of work.
 */

import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { safeCompressImage } from './safeCompressImage';
import { uuidv4 } from '../Supabase/uuid';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

/** Product limit. Also enforced by a check constraint in 030. */
export const MAX_EVIDENCE_IMAGES = 3;

/**
 * Open the library and return local uris, capped so the caller can never end
 * up holding more than MAX_EVIDENCE_IMAGES.
 *
 * Returns [] when the user cancels — cancelling is not an error and must not
 * surface as one, because it happens on most opens.
 *
 * THROWS when the picker itself fails. Cancel and failure used to share that
 * empty return, which meant a picker that could not open was indistinguishable
 * from a mod changing their mind: the Add tile did nothing, silently, with
 * nothing left behind to diagnose from. Since the whole point of this screen
 * is a mod mid-ban believing they attached proof, the two now differ so the
 * caller's catch can say so out loud.
 */
export const pickEvidenceImages = async (alreadyPicked = 0) => {
  const remaining = Math.max(0, MAX_EVIDENCE_IMAGES - alreadyPicked);
  if (remaining === 0) return [];

  const res = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: remaining,
    // Evidence is read, not admired. Capping here keeps the later compress
    // cheap on the low-end devices a lot of the mod team is on.
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.9,
  });

  if (res?.didCancel) return [];

  if (res?.errorCode) {
    // errorMessage is frequently empty on Android, so the code carries the
    // diagnosis — 'permission' and 'others' point at very different fixes
    // when a mod reports this.
    throw new Error(res.errorMessage || `Photo picker failed (${res.errorCode}).`);
  }

  return (res?.assets || []).map((a) => a?.uri).filter(Boolean).slice(0, remaining);
};

/**
 * Compress and upload one local uri. Resolves to a CDN URL.
 *
 * Compression is best-effort: safeCompressImage hands back the ORIGINAL uri
 * inside its result when it cannot do better, so a failure there costs bytes,
 * not the upload.
 *
 * It resolves to an object — { uri, compressed, reason } — on every path, and
 * it never rejects. This used to read `await safeCompressImage(uri)` as if it
 * were a bare string, so `.catch` never fired, the object was truthy enough to
 * survive `|| uri`, and String() turned it into the literal read path
 * '[object Object]'. Every attach failed with ENOENT. Unwrap `.uri`, the way
 * all eight other call sites in the app do.
 */
const uploadOne = async (uri) => {
  // returnableOutputType matches the other call sites: safeCompressImage only
  // checks that the compressor returned *a string*, so base64 would sail
  // through its guard and be used as a path.
  const compressed = await safeCompressImage(uri, { returnableOutputType: 'uri' }).catch(() => null);
  const local = compressed?.uri || uri;
  const remotePath = `mod-evidence/${uuidv4()}.jpg`;

  const base64 = await RNFS.readFile(String(local).replace('file://', ''), 'base64');
  // global.atob, not bare atob: it exists at runtime (UploadModal relies on
  // the same call in production) but is absent from this project's ESLint
  // env, so the bare form is a no-undef error.
  const binary = Uint8Array.from(global.atob(base64), (c) => c.charCodeAt(0));

  const res = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
    method: 'PUT',
    headers: {
      AccessKey: BUNNY_ACCESS_KEY,
      'Content-Type': 'application/octet-stream',
    },
    body: binary,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Bunny upload failed ${res.status}: ${txt.slice(0, 120)}`);
  }

  return `${BUNNY_CDN_BASE}/${remotePath}`;
};

/**
 * Upload every picked image, in order.
 *
 * ⚠️ This one DOES throw, unlike logModAction. The evidence is the point of
 * the attachment: silently banning someone with the proof missing is worse
 * than making the mod retry, and they still have the images in hand at that
 * moment. Callers should surface the failure and let the mod decide whether
 * to ban without it.
 *
 * `onProgress(done, total)` fires after each upload so the button can count.
 */
export const uploadEvidence = async (uris = [], onProgress) => {
  const list = (Array.isArray(uris) ? uris : []).filter(Boolean).slice(0, MAX_EVIDENCE_IMAGES);
  if (list.length === 0) return [];

  const urls = [];
  for (const uri of list) {
    urls.push(await uploadOne(uri));
    if (typeof onProgress === 'function') onProgress(urls.length, list.length);
  }
  return urls;
};
