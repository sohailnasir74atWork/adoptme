import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged, signOut, signInWithCredential, GoogleAuthProvider } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue, remove, query, orderByValue, equalTo } from '@react-native-firebase/database';
import { getFirestore, doc, onSnapshot } from '@react-native-firebase/firestore';
import { createNewUser, registerForNotifications } from './Globelhelper';
import { getBlocks, getRoblox, getIdentity, getRoles, getCosmetics, setLastActivity } from './Supabase/userBackend';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, AppState, Appearance } from 'react-native';
import { getFlag } from './Helper/CountryCheck';
import { generateOnePieceUsername } from './Helper/RendomNamegen';
import { getCrashlytics, setUserId as setCrashlyticsUserId, setAttribute as setCrashlyticsAttribute, log as crashlyticsLog, recordError as crashlyticsRecordError } from '@react-native-firebase/crashlytics';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { ensureGoogleSignInConfigured } from './Firebase/googleSignInConfig';

// ── Auth diagnostics + silent re-login state (2026-09-04) ───────────────
// Users reported "logged out for no reason, can't log back in until I clear
// app data". Causes found: the Android Firebase Auth encrypted-persistence
// regression (firebase-auth 24.0.1), Google-side token revocations turning
// into a silent native sign-out, and a stale cached Google account breaking
// the next sign-in. These helpers (a) attribute every automatic sign-out in
// Crashlytics and (b) try one silent Google re-login per launch before the
// app shows the logged-out UI.
const _launchedAt = Date.now();
let _silentReloginTried = false;
let _lastAuthUid = null;
const logAuthEvent = (message, record = false) => {
  try {
    const c = getCrashlytics();
    crashlyticsLog(c, message);
    if (record) crashlyticsRecordError(c, new Error(message));
  } catch (_) {}
};
import { getDeviceFingerprint } from './Helper/deviceFingerprint';
import { getServerTime, warmServerTime } from './Helper/serverTime';



const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
const firestoreDB = getFirestore(app);
const appdatabase = getDatabase(app);
const GlobalStateContext = createContext();



// Custom hook to access global state
export const useGlobalState = () => useContext(GlobalStateContext);

export const GlobalStateProvider = ({ children }) => {
  const { localState, updateLocalState } = useLocalState()

  const colorScheme = useColorScheme(); // 'light' or 'dark' or null

  const resolveTheme = (userPref, systemScheme) =>
    userPref === 'system' ? (systemScheme || 'light') : userPref;

  const [theme, setTheme] = useState(() => resolveTheme(localState.theme, colorScheme));
  const [api, setApi] = useState(null);
  const [freeTranslation, setFreeTranslation] = useState(null);
  const [currentUserEmail, setCurrentuserEmail] = useState('')
  const [single_offer_wall, setSingle_offer_wall] = useState(false)
  // World Cup feature kill switch. Default true (feature on); set RTDB
  // /worldcup_enabled = false from the backend to hide the whole feature.
  const [worldCupEnabled, setWorldCupEnabled] = useState(true);
  // Moderator ban/mute kill switch. Default true (mods can ban/mute); admins
  // flip RTDB /mod_controls_enabled = false in the Admin Dashboard to strip
  // ban/mute/strike from moderators. Admins are never affected.
  const [modControlsEnabled, setModControlsEnabled] = useState(true);
  // JMD-grant delegation. The owner can hand the "Make Junior Mod" power to any
  // user from the Admin Dashboard; the grant lives at RTDB /jmd_granters/{uid}.
  // Admins and the hardcoded owner UID never depend on this flag.
  const [canGrantJmd, setCanGrantJmd] = useState(false);
  const [tradingServerLink, setTradingServerLink] = useState(null); // Trading server link from admin servers



  const [isAdmin, setIsAdmin] = useState(false);
  const [isInActiveGame, setIsInActiveGame] = useState(false); // ✅ Track if user is in active game
  const [acceptedInviteRoom, setAcceptedInviteRoom] = useState(null); // ✅ { roomId, gameType } from toast accept
  const [user, setUser] = useState({
    id: null,
    // selectedFruits: [],
    // isReminderEnabled: false,
    // isSelectedReminderEnabled: false,
    displayName: '',
    avatar: null,
    // rewardPoints: 0,
    isBlock: false,
    fcmToken: null,
    lastActivity: null,
    online: false,
    isPro: false,
    createdAt: null


  });

  const [loading, setLoading] = useState(false);
  const [isRTDBConnected, setIsRTDBConnected] = useState(true); // optimistic — avoids blocking sends before first Firebase handshake

  // Ban state — email-keyed and device-keyed are tracked separately so a
  // banned user can't escape by re-registering with a fresh email on the
  // same device. `isUserBlocked` is the OR of both — gates should read it
  // instead of either flag in isolation.
  const [_isEmailBanned, setIsEmailBanned] = useState(false);
  const [_isDeviceBanned, setIsDeviceBanned] = useState(false);
  const isUserBlocked = _isEmailBanned || _isDeviceBanned;
  const [strikeInfo, setStrikeInfo] = useState(null);
  // Full payload from `banned_devices/{fp}` when this device is flagged.
  // Carries the email + userId of the ORIGINAL banned account so the
  // ban-card UI can show "your associated account is banned" copy.
  const [deviceBanInfo, setDeviceBanInfo] = useState(null);

  // const [robloxUsername, setRobloxUsername] = useState('');
  const robloxUsernameRef = useRef('');
  // Last isPro value known to be in RTDB (users/{uid} read at login, or our own
  // last write) so updateUserProStatus only writes when the value changes —
  // every /users write fans out to two Cloud Functions.
  const lastKnownIsProRef = useRef({ uid: null, value: undefined });

  // Keep localState.theme in a ref so the Appearance listener can read it without stale closures
  const themeSettingRef = useRef(localState.theme);
  useEffect(() => { themeSettingRef.current = localState.theme; }, [localState.theme]);

  // Track theme changes from useColorScheme
  useEffect(() => {
    setTheme(resolveTheme(localState.theme, colorScheme));
  }, [localState.theme, colorScheme]);

  // Robust fallback: Appearance.addChangeListener catches system theme changes
  // even when useColorScheme hook doesn't re-trigger (known RN issue on some devices)
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme: newScheme }) => {
      if (themeSettingRef.current === 'system') {
        setTheme(newScheme || 'light');
      }
    });
    return () => sub?.remove();
  }, []);

  // const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false

  // ✅ Store updateLocalState in ref to avoid dependency issues
  const updateLocalStateRef = useRef(updateLocalState);
  useEffect(() => {
    updateLocalStateRef.current = updateLocalState;
  }, [updateLocalState]);

  // ✅ Keep localState accessible via ref for memoized callbacks (avoids stale closures)
  const localStateRef = useRef(localState);
  useEffect(() => {
    localStateRef.current = localState;
  }, [localState]);

  // ✅ Memoize updateLocalStateAndDatabase to prevent infinite loops and duplicate writes
  const updateLocalStateAndDatabase = useCallback(async (keyOrUpdates, value) => {
    try {
      let updates = {};

      if (typeof keyOrUpdates === 'string') {
        updates = { [keyOrUpdates]: value };
        await updateLocalStateRef.current(keyOrUpdates, value); // ✅ Use ref to avoid dependency
      } else if (typeof keyOrUpdates === 'object') {
        updates = keyOrUpdates;
        for (const [key, val] of Object.entries(updates)) {
          await updateLocalStateRef.current(key, val); // ✅ Use ref to avoid dependency
        }
      } else {
        throw new Error('Invalid arguments for update.');
      }

      // ✅ Update in-memory user state and Firebase in one functional update (prevents duplicate writes)
      setUser((prev) => {
        // ✅ Check if updates are actually different to prevent duplicate writes
        const hasChanges = Object.keys(updates).some(key => prev[key] !== updates[key]);
        if (!hasChanges && prev?.id) {
          // No changes, skip Firebase write
          return prev;
        }

        const updatedUser = { ...prev, ...updates };

        // ✅ Update Firebase only if user is logged in and there are actual changes
        // ✅ Exclude 'online' field from user data (it's stored in presence/{uid} node)
        if (prev?.id && appdatabase && hasChanges) {
          const userRef = ref(appdatabase, `users/${prev.id}`);
          const userDataUpdates = { ...updates };
          delete userDataUpdates.online; // ✅ Don't sync online to user data
          update(userRef, userDataUpdates).catch((error) => {
            // Silently handle Firebase errors
          });
        }

        return updatedUser;
      });
    } catch (error) {
      // console.error('❌ Error updating user state or database:', error);
    }
  }, [appdatabase]); // ✅ Removed updateLocalState from deps, using ref instead



  // ✅ Use ref to track if flag has been set for current user (prevents infinite loop)
  const flagSetForUserRef = useRef(null);
  const updateLocalStateAndDatabaseRef = useRef(updateLocalStateAndDatabase);

  // ✅ Keep ref updated with latest function
  useEffect(() => {
    updateLocalStateAndDatabaseRef.current = updateLocalStateAndDatabase;
  }, [updateLocalStateAndDatabase]);

  // ✅ PERF FIX #8: Removed user?.flage from deps to prevent circular re-triggering.
  // The effect itself calls setUser({...prev, flage}), which changed user?.flage,
  // which re-triggered this effect. Now we use a ref to track the current flag state.
  const userFlageRef = useRef(user?.flage);
  useEffect(() => { userFlageRef.current = user?.flage; }, [user?.flage]);

  useEffect(() => {
    if (!isAdmin && user?.id && appdatabase) {
      // ✅ Only set flag once per user.id to prevent infinite loop
      if (flagSetForUserRef.current !== user.id) {
        flagSetForUserRef.current = user.id;

        // ✅ Only store flag if user wants to show it (saves Firebase data costs)
        if (localState?.showFlag !== false) {
          // User wants to show flag - store it
          updateLocalStateAndDatabaseRef.current({ flage: getFlag() });
        }
        // If showFlag is false, don't store flag (saves data)
      } else {
        // ✅ Handle flag toggle changes after initial setup
        const currentFlage = userFlageRef.current;
        if (localState?.showFlag === false && currentFlage) {
          // ✅ User toggled flag off - remove it from Firebase to save data
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: null }).catch(() => { });
          setUser((prev) => ({ ...prev, flage: null }));
        } else if (localState?.showFlag !== false && !currentFlage) {
          // ✅ User toggled flag on - add it
          const flagValue = getFlag();
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: flagValue }).catch(() => { });
          setUser((prev) => ({ ...prev, flage: flagValue }));
        }
      }
    }
  }, [user?.id, isAdmin, localState?.showFlag, appdatabase]) // ✅ PERF FIX: Removed user?.flage — uses ref instead

  // ✅ Memoize resetUserState to prevent unnecessary re-renders
  const resetUserState = useCallback(() => {
    setUser({
      id: null,
      // selectedFruits: [],
      // isReminderEnabled: false,
      // isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      // rewardPoints: 0,
      isBlock: false,
      fcmToken: null,
      lastActivity: null,
      online: false,
      isPro: false,
      createdAt: null
    });
    setIsAdmin(false);
  }, []); // No dependencies, so it never re-creates

  // ✅ Memoize handleUserLogin
  const handleUserLogin = useCallback(async (loggedInUser) => {
    if (!loggedInUser) {
      lastKnownIsProRef.current = { uid: null, value: undefined };
      resetUserState(); // No longer recreates resetUserState
      return;
    }
    try {
      const userId = loggedInUser.uid;
      const userRef = ref(appdatabase, `users/${userId}`);

      // 2026-09-04: a read that FAILS (offline, denied, hung socket) must never
      // look like "this user has no record" — that path used to run the
      // new-user branch and could overwrite a real profile, or hang forever
      // leaving Firebase signed in while the UI stayed logged out. Every RTDB
      // read below is capped at 10 s and failures are tagged READ_FAILED.
      const READ_FAILED = Symbol('read-failed');
      let readsUnreachable = false;
      const withTimeout = (p, ms = 10000) => Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error('rtdb-timeout')), ms)),
      ]);

      // ── RTDB-read reduction (login is the #1 RTDB read source) ─────────
      // This used to fan out into ~21 individual RTDB leaf reads
      // (users/{uid}/email, /displayName, /admin, …) on every login. Most of
      // those fields are now mirrored into Supabase (user_identity /
      // user_roles / user_cosmetics / user_roblox), so we read them there and
      // only hit RTDB for the handful of leaves not yet mirrored.
      //
      // RTDB stays the source of truth — every write path is unchanged and the
      // mirror CF keeps Supabase fresh. If the Supabase identity row is missing
      // (brand-new user, mirror lag, or a not-yet-authed Supabase session) we
      // fall back to the original full RTDB projection, so behaviour is
      // identical in every edge case; we only skip the RTDB reads on the common
      // path where the mirror already has the row. A partial mirror (identity
      // present but roles/cosmetics missing) selectively re-reads just those
      // leaves from RTDB so isPro / role flags can never be transiently lost.
      const PROJECTION = [
        'email', 'decodedEmail', 'createdAt',
        'displayName', 'avatar', 'userName',
        'isPro', 'admin', 'isModerator', 'isBabyMod', 'isTrusted', 'isCMSR', 'isHelper',
        'topBadge', 'flage', 'dateOfBirth', 'lastProfileEditAt',
        'lastGameWinAt', 'hasRecentGameWin', 'rewardPoints', 'isPlaying',
        'chatOffTrade', 'chatOffGeneral',
      ];
      // Leaves not yet mirrored to Supabase — still authoritative on RTDB.
      // `flage` stays here too: the mirror renames it to `flag`, so reading the
      // original leaf keeps country flags exactly correct.
      const RTDB_ONLY = ['userName', 'flage', 'lastGameWinAt', 'hasRecentGameWin', 'rewardPoints', 'isPlaying', 'chatOffTrade', 'chatOffGeneral'];

      const [identityRow, rolesRow, cosmeticsRow, robloxRow, rtdbOnlySnaps, xpSnap] = await Promise.all([
        getIdentity(userId).catch(() => null),
        getRoles(userId).catch(() => null),
        getCosmetics(userId).catch(() => null),
        getRoblox(userId).catch(() => null),
        Promise.all(RTDB_ONLY.map((f) => withTimeout(get(ref(appdatabase, `users/${userId}/${f}`))).catch(() => null))),
        withTimeout(get(ref(appdatabase, `users/${userId}/xp`))).catch(() => null),
      ]);

      const xpVal = xpSnap && xpSnap.exists() ? xpSnap.val() : undefined;
      const rtdbOnly = {};
      RTDB_ONLY.forEach((f, i) => {
        const s = rtdbOnlySnaps[i];
        if (s && s.exists()) rtdbOnly[f] = s.val();
      });

      let existing = null;
      if (identityRow) {
        // Map mirrored Supabase rows back onto the RTDB leaf names the rest of
        // this function (and the app) consume. Only present keys are set,
        // matching how the old per-snapshot rebuild behaved.
        existing = { ...rtdbOnly };
        if (identityRow.email != null)             existing.email = identityRow.email;
        if (identityRow.decodedEmail != null)      existing.decodedEmail = identityRow.decodedEmail;
        if (identityRow.createdAt != null)         existing.createdAt = identityRow.createdAt;
        if (identityRow.displayName != null)       existing.displayName = identityRow.displayName;
        if (identityRow.avatar != null)            existing.avatar = identityRow.avatar;
        if (identityRow.dateOfBirth != null)       existing.dateOfBirth = identityRow.dateOfBirth;
        if (identityRow.lastProfileEditAt != null) existing.lastProfileEditAt = identityRow.lastProfileEditAt;
        if (cosmeticsRow) {
          existing.isPro = cosmeticsRow.isPro;
          if (cosmeticsRow.topBadge != null) existing.topBadge = cosmeticsRow.topBadge;
        }
        if (rolesRow) {
          existing.admin = rolesRow.isAdmin;
          existing.isModerator = rolesRow.isModerator;
          existing.isBabyMod = rolesRow.isBabyMod;
          existing.isTrusted = rolesRow.isTrusted;
          existing.isCMSR = rolesRow.isCMSR;
          existing.isHelper = rolesRow.isHelper;
        }
        // Selective RTDB fallback for any table the mirror hasn't filled yet.
        const missing = [];
        if (!cosmeticsRow) missing.push('isPro', 'topBadge');
        if (!rolesRow) missing.push('admin', 'isModerator', 'isBabyMod', 'isTrusted', 'isCMSR', 'isHelper');
        if (missing.length) {
          const snaps = await Promise.all(
            missing.map((p) => get(ref(appdatabase, `users/${userId}/${p}`)).catch(() => null))
          );
          missing.forEach((p, i) => {
            if (snaps[i] && snaps[i].exists()) existing[p] = snaps[i].val();
          });
        }
        if (xpVal !== undefined) existing.xp = xpVal;
      } else {
        // Supabase identity miss → authoritative full RTDB projection (the
        // original path). Disambiguates brand-new vs mirror-lag so we never
        // clobber an existing RTDB user by treating them as new.
        const fieldSnaps = await Promise.all(
          PROJECTION.map((f) => withTimeout(get(ref(appdatabase, `users/${userId}/${f}`))).catch(() => READ_FAILED))
        );
        const anyExists = fieldSnaps.some((s) => s && s !== READ_FAILED && s.exists()) || xpVal !== undefined;
        if (anyExists) {
          existing = {};
          PROJECTION.forEach((f, i) => {
            if (fieldSnaps[i] && fieldSnaps[i] !== READ_FAILED && fieldSnaps[i].exists()) existing[f] = fieldSnaps[i].val();
          });
          if (xpVal !== undefined) existing.xp = xpVal;
        } else if (fieldSnaps.every((s) => s === READ_FAILED)) {
          // Nothing could be read at all → we cannot tell new from existing.
          readsUnreachable = true;
        }
      }

      if (existing === null && readsUnreachable) {
        // Backend unreachable: keep the user SIGNED IN with a minimal profile
        // (no RTDB writes — never treat an existing user as new here). The next
        // launch / reconnect re-runs this handler and loads the full record.
        logAuthEvent(`auth_login_reads_unreachable uid=${userId}`, true);
        const minimal = {
          id: userId,
          email: loggedInUser.email || null,
          displayName: loggedInUser.displayName || 'Anonymous',
          avatar: loggedInUser.photoURL || null,
          createdAt: Date.now(),
        };
        setCurrentuserEmail(loggedInUser.email);
        setUser(minimal);
        return;
      }

      const exists = existing !== null;
      let userData;

      // Admin identity comes from the real, already-mirrored role flag
      // (RTDB users/{uid}/admin → Supabase user_roles.is_admin) — the same
      // field every badge and profile read already trusts. To make someone an
      // owner, set that flag; there is no UID hardcoded anywhere any more.
      // The founder emails stay ONLY as a bootstrap so the first admin can
      // always sign in and set the flag on others (and can never be locked out
      // by a bad write). Always assign, so a revoked flag actually clears.
      const makeadmin = loggedInUser.email === 'thesolanalabs@gmail.com' || loggedInUser.email === 'sohailnasir74business@gmail.com' || loggedInUser.email === 'sohailnasir74@gmail.com';
      setIsAdmin(makeadmin || existing?.admin === true);
      setCurrentuserEmail(loggedInUser.email)

      if (exists) {
        // ⏳ USER EXISTS → existing built above (Supabase mirror or RTDB fallback)

        // ✅ SELF-HEALING: Update email if missing or changed
        if (loggedInUser.email && (!existing.email || existing.email !== loggedInUser.email)) {
          const emailUpdates = {
            email: loggedInUser.email,
            decodedEmail: loggedInUser.email.replace(/\./g, '(dot)'),
          };
          await update(userRef, emailUpdates).catch(err => console.log("Email update error:", err));
          // Merge updates into existing object so local state is correct immediately
          Object.assign(existing, emailUpdates);
        }

        userData = {
          ...existing,
          id: userId,
          createdAt: existing.createdAt || Date.now()   // fallback if missing
        };

        // ✅ SELF-HEALING: Persist createdAt to RTDB if it was missing
        // so other users (e.g. BottomDrawer) can see the joined date
        if (!existing.createdAt && userData.createdAt) {
          update(userRef, { createdAt: userData.createdAt }).catch(() => {});
        }

        // ✅ SELF-HEALING: Fix users stuck with 'Anonymous' or empty displayName
        if (!userData.displayName || userData.displayName === 'Anonymous') {
          const newName = generateOnePieceUsername();
          if (newName) {
            userData.displayName = newName;
            await update(userRef, { displayName: newName }).catch(() => {});
          }
        }

      } else {
        // 🆕 NEW USER → Set createdAt once
        userData = {
          ...createNewUser(userId, loggedInUser, robloxUsernameRef?.current),
          createdAt: Date.now()
        };

        // update() instead of set(): identical for a genuinely new node, but if
        // this branch is ever reached for an existing user it merges instead
        // of wiping fields the projection does not carry (roles, coins, shop…).
        await update(userRef, userData);
      }

      // Merge Supabase roblox fields. Supabase wins; fall back to whatever
      // PROJECTION returned (brand-new user: robloxUsernameRef from signup).
      if (robloxRow) {
        userData.robloxUsername = robloxRow.robloxUsername ?? userData.robloxUsername ?? null;
        userData.robloxUserId = robloxRow.robloxUserId ?? userData.robloxUserId ?? null;
        userData.robloxUsernameVerified = robloxRow.robloxUsernameVerified ?? false;
      }

      lastKnownIsProRef.current = {
        uid: userId,
        value: typeof userData?.isPro === 'boolean' ? userData.isPro : undefined,
      };
      setUser(userData);

      // 🔥 Crashlytics: tag this user so crash reports show who was affected
      try {
        const crashlyticsInstance = getCrashlytics();
        setCrashlyticsUserId(crashlyticsInstance, userId);
        if (loggedInUser.email) setCrashlyticsAttribute(crashlyticsInstance, 'email', loggedInUser.email);
        if (userData.displayName) setCrashlyticsAttribute(crashlyticsInstance, 'displayName', userData.displayName);
      } catch (_) {}

      // 🔥 Refresh and update FCM token.
      // Fire-and-forget on purpose. This runs after setUser() above, so the
      // user state the tree renders from is already in place and nothing on
      // screen is waiting on it — but awaiting it held the boot splash up for
      // a full network round trip on first launch. Failures are already
      // non-fatal (a missing token only costs push delivery until next login).
      registerForNotifications(userId).catch(() => {});

      // Stamp the current device's fingerprint on users/{uid}/deviceId so
      // mirrorBanToDevice can lock this device when the account is banned
      // from any other session. Best-effort, fire-and-forget — failure here
      // (Keychain locked, RTDB write rejected) only weakens device-ban
      // enforcement for the current session, not core auth.
      // 2026-09: deviceId is not part of the login projection above, so read
      // the single leaf first and only write when it differs — a read is far
      // cheaper than a /users write (which fires two Cloud Functions). A
      // failed read falls through to the write, i.e. the previous behaviour.
      getDeviceFingerprint().then(async (fp) => {
        if (!fp) return;
        let current;
        try {
          const snap = await get(ref(appdatabase, `users/${userId}/deviceId`));
          current = snap && snap.exists() ? snap.val() : undefined;
        } catch (_) {
          current = undefined;
        }
        if (current === fp) return;
        update(ref(appdatabase, `users/${userId}`), { deviceId: fp }).catch(() => {});
      }).catch(() => {});

    } catch (error) {
      // console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState
  // ✅ PERF FIX #10: Removed duplicate registerForNotifications useEffect.
  // FCM registration is already called in handleUserLogin (line 277) and
  // onAuthStateChanged (line 312). This extra useEffect was a 3rd redundant call.


  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
      // ── Silent sign-out attribution + one silent Google re-login per launch ──
      if (!loggedInUser) {
        const prevUid = _lastAuthUid;
        _lastAuthUid = null;
        if (!_silentReloginTried) {
          _silentReloginTried = true;
          try {
            ensureGoogleSignInConfigured();
            const hasPrev = typeof GoogleSignin.hasPreviousSignIn === 'function'
              ? GoogleSignin.hasPreviousSignIn()
              : false;
            if (hasPrev) {
              const res = await GoogleSignin.signInSilently();
              const idToken = res?.idToken || res?.data?.idToken;
              if (idToken) {
                await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
                logAuthEvent(`auth_silent_relogin_ok hadPrevUid=${prevUid ? 1 : 0} msSinceLaunch=${Date.now() - _launchedAt}`);
                return; // this listener fires again with the restored user
              }
            }
          } catch (e) {
            logAuthEvent(`auth_silent_relogin_failed code=${e?.code || ''} msg=${String(e?.message || '').slice(0, 80)}`);
          }
        }
        if (prevUid) {
          logAuthEvent(`auth_signed_out reason=native-null prevUid=${prevUid} msSinceLaunch=${Date.now() - _launchedAt}`, true);
        }
      } else {
        _lastAuthUid = loggedInUser.uid;
      }

      // Enforce email verification ONLY for the email/password provider.
      // onAuthStateChanged fires with the PERSISTED session on every cold
      // start / token refresh, so signing out every emailVerified=false user
      // here was logging social-login users out on each launch — Apple (and
      // some Google) accounts report emailVerified=false. Email/password
      // verification is already enforced at sign-in (SigninDrawer register +
      // login both sign the user out until verified), so this is just a
      // backstop for that one provider; trusted social providers pass through.
      const isPasswordUser = !!loggedInUser?.providerData?.some(p => p?.providerId === 'password');
      if (loggedInUser && isPasswordUser && !loggedInUser.emailVerified) {
        logAuthEvent(`auth_signed_out reason=password-unverified uid=${loggedInUser.uid}`);
        await signOut(auth);
        return;
      }

      requestIdleCallback(async () => {
        // isAppReady is ONLY the boot-splash gate (App.js calls
        // RNBootSplash.hide on it — nothing else reads it), so what we await
        // before setting it is exactly what a first-launch user spends staring
        // at the logo. Everything that does not have to be on screen before
        // the first frame belongs below it, not above.
        try {
          // This one DOES gate the splash: it ends in setUser(), and the whole
          // tree renders from that user object. Showing the UI first would
          // flash a signed-out app at an already signed-in user.
          // It swallows its own errors internally, so it should not throw.
          await handleUserLogin(loggedInUser);
        } catch (e) {
          logAuthEvent(`auth_handle_login_failed msg=${String(e?.message || e).slice(0, 80)}`);
        } finally {
          // In `finally` so a throw above can never strand the splash on
          // screen forever. Before this change the splash hide sat at the very
          // end of this callback with two un-caught awaits in front of it —
          // one rejection there and the user was left looking at the logo with
          // no way out but a reinstall.
          await updateLocalState('isAppReady', true);
        }

        // ── Below here: background hydration. Never block the first frame. ──
        //
        // registerForNotifications is deliberately NOT called here.
        // handleUserLogin already registers the FCM token (see "Refresh and
        // update FCM token" in it), so the call that used to sit on this line
        // was a second identical network round trip on every single login —
        // and it was awaited, so the splash paid for both.
        if (loggedInUser?.uid) {
          // Hydrate localState.bannedUsers from Supabase user_blocks once per
          // login. The list lives in MMKV across launches, so subsequent
          // block/unblock writes still update it locally + RTDB (mirror CF
          // replays to Supabase). This seed only runs at sign-in to cover
          // first-install or device-switch cases where MMKV is empty — and in
          // exactly that case (fresh install) there is nothing to hydrate, so
          // letting it land a moment after the first frame costs nothing.
          // RTDB fallback (full /users/{uid}/blocked_users read) only fires
          // if Supabase returns an error — null result for "no blocks" is
          // an empty Set, not an error.
          try {
            const supaBlocks = await getBlocks(loggedInUser.uid);
            if (supaBlocks instanceof Set) {
              await updateLocalState('bannedUsers', [...supaBlocks]);
            } else if (appdatabase) {
              const snap = await get(ref(appdatabase, `users/${loggedInUser.uid}/blocked_users`));
              const obj = snap.exists() ? (snap.val() || {}) : {};
              await updateLocalState('bannedUsers', Object.keys(obj));
            }
          } catch {}
        }
      });
    });

    return () => unsubscribe();
  }, []);



  useEffect(() => {
    const fetchAPIKeys = async () => {
      try {
        const apiRef = ref(appdatabase, 'api');
        const paywallSecondOnlyFlagRef = ref(appdatabase, 'single_offer_wall');
        const freeRef = ref(appdatabase, 'free_translation');

        const [snapshotApi, paywallSecondOnlyFlag, snapshotFree] = await Promise.all([
          get(apiRef),
          get(paywallSecondOnlyFlagRef),
          get(freeRef),
        ]);

        if (snapshotApi.exists()) {
          const value = snapshotApi.val();
          setApi(value);
        } else {
          // console.warn('⚠️ No Google Translate API key found at /api');
        }

        if (snapshotFree.exists()) {
          const value = snapshotFree.val();
          setFreeTranslation(value);
        } else {
          // console.warn('⚠️ No free translation key found at /free_translation');
        }
        if (paywallSecondOnlyFlag.exists()) {
          const value = paywallSecondOnlyFlag.val();
          // console.log('chec', value)
          setSingle_offer_wall(value);
          // console.log('🔑 [Firebase] Free Translation Key from /free_translation:', value);
        } else {
          console.warn('⚠️ No free translation key found at /free_translation');
        }


      } catch (error) {
        // console.error('🔥 Error fetching API keys from Firebase:', error);
      }
    };

    fetchAPIKeys();
  }, []);

  // World Cup kill switch — fully isolated so a read failure can NEVER affect
  // other flags. Default stays ON; only an explicit `false` hides the feature.
  // NOTE: requires an RTDB read rule for /worldcup_enabled (rules are per-node
  // with no root default-read), otherwise the read is denied and we stay ON.
  useEffect(() => {
    if (!appdatabase) return;
    get(ref(appdatabase, 'worldcup_enabled'))
      .then((snap) => setWorldCupEnabled(snap.val() !== false))
      .catch(() => { /* denied / offline → leave feature ON */ });
  }, [appdatabase]);

  // Moderator ban/mute kill switch — live subscription so an admin flipping it
  // takes effect on every moderator's device immediately. Default stays ON;
  // only an explicit `false` strips ban/mute/strike from moderators.
  // NOTE: requires an RTDB read rule on /mod_controls_enabled — without it the
  // read is denied and the flag stays ON (the OFF state would not propagate).
  useEffect(() => {
    if (!appdatabase) return;
    const r = ref(appdatabase, 'mod_controls_enabled');
    const unsub = onValue(
      r,
      (snap) => setModControlsEnabled(snap.val() !== false),
      () => { /* denied / offline → leave ON */ }
    );
    return () => { try { unsub(); } catch (e) { /* noop */ } };
  }, [appdatabase]);

  // Delegated JMD-grant permission for the signed-in user. Single leaf listener
  // on /jmd_granters/{uid} — negligible RTDB cost, and a revoke propagates to
  // the device immediately. Denied/offline reads leave the flag OFF (fail closed).
  useEffect(() => {
    if (!appdatabase || !user?.id) { setCanGrantJmd(false); return; }
    const r = ref(appdatabase, `jmd_granters/${user.id}`);
    const unsub = onValue(
      r,
      (snap) => setCanGrantJmd(snap.exists() && snap.val() !== false),
      () => setCanGrantJmd(false),
    );
    return () => { try { unsub(); } catch (e) { /* noop */ } };
  }, [appdatabase, user?.id]);

  // Live role flags for the signed-in user (2026-09-04): a demoted moderator /
  // junior mod loses the powers immediately instead of at next login. Two leaf
  // listeners for the whole session — negligible RTDB cost. Denied/offline
  // reads keep the current value.
  useEffect(() => {
    if (!appdatabase || !user?.id) return;
    const uid = user.id;
    const unsubs = ['isModerator', 'isBabyMod'].map((flag) => onValue(
      ref(appdatabase, `users/${uid}/${flag}`),
      (snap) => {
        const v = !!(snap && snap.exists() && snap.val() === true);
        setUser((prev) => (prev && prev.id === uid && prev[flag] !== v ? { ...prev, [flag]: v } : prev));
      },
      () => { /* denied / offline → keep current value */ },
    ));
    return () => unsubs.forEach((u) => { try { u(); } catch (e) { /* noop */ } });
    // appdatabase is a module-level constant, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Fetch trading server link with 3 hour caching
  // ✅ FIXED: Run once on mount only — deps no longer include values this effect updates
  useEffect(() => {
    if (!appdatabase) return;

    const fetchTradingServerLink = async () => {
      try {
        // Read from MMKV directly to avoid stale closure
        const cachedLink = localState.tradingServerLink;
        const lastFetch = localState.lastServerFetch ? new Date(localState.lastServerFetch).getTime() : 0;
        const now = Date.now();
        const EXPIRY_LIMIT = 3 * 60 * 60 * 1000; // 3 hours

        if ((now - lastFetch) > EXPIRY_LIMIT || !cachedLink) {
          const serverRef = ref(appdatabase, 'server');
          const snapshot = await get(serverRef);

          if (snapshot.exists()) {
            const serverData = snapshot.val();
            const serverList = Object.entries(serverData).map(([id, value]) => ({ id, ...value }));
            const firstServer = serverList.length > 0 ? serverList[0] : null;
            const serverLink = firstServer?.link || null;

            if (serverLink) {
              setTradingServerLink(serverLink);
              updateLocalStateRef.current('tradingServerLink', serverLink);
              updateLocalStateRef.current('lastServerFetch', new Date().toISOString());
            }
          }
        } else if (cachedLink) {
          setTradingServerLink(cachedLink);
        }
      } catch (error) {
        console.error('Error fetching trading server link:', error);
        if (localState.tradingServerLink) {
          setTradingServerLink(localState.tradingServerLink);
        }
      }
    };

    fetchTradingServerLink();
  }, [appdatabase]); // ✅ Only re-run if appdatabase changes (once)

  // ✅ PERF: Memoize updateUserProStatus to prevent recreation every render
  const updateUserProStatus = useCallback(() => {
    if (!user?.id || !appdatabase) return;
    const nextIsPro = localState?.isPro;
    const known = lastKnownIsProRef.current;
    // Skip the write when RTDB already holds this value (login read / last write).
    if (known?.uid === user.id && known.value === nextIsPro) return;
    const userIsProRef = ref(appdatabase, `users/${user.id}/isPro`);
    set(userIsProRef, nextIsPro)
      .then(() => {
        lastKnownIsProRef.current = { uid: user.id, value: nextIsPro };
      })
      .catch(() => {});
  }, [user?.id, appdatabase, localState?.isPro]);

  useEffect(() => {
    const id = requestIdleCallback(updateUserProStatus);
    return () => cancelIdleCallback(id);
  }, [updateUserProStatus]);

  useEffect(() => {
    // Stored as ms epoch (number) so it lines up with createdAt and the
    // Supabase user_identity.last_activity_ms column (bigint). Used for
    // "inactive 30+ days" cohort queries — daily resolution is plenty,
    // so we throttle to ~1 heartbeat per active user per day.
    //
    // The write goes STRAIGHT to Supabase (set_last_activity RPC, see
    // supabase/018_user_last_activity.sql) instead of going through
    // RTDB → mirrorUsersToSupabase. The mirror CF was firing on every
    // 6h heartbeat for no other mirrored field's benefit — that was
    // the largest remaining cost lever per the cost-reduction handoff.
    const HEARTBEAT_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h
    const prev = localStateRef.current?.lastActivity;
    const prevMs = typeof prev === 'number'
      ? prev
      : (prev ? new Date(prev).getTime() : 0);
    const now = Date.now();
    if (Number.isFinite(prevMs) && now - prevMs < HEARTBEAT_THROTTLE_MS) return;
    // Persist locally so the throttle survives app restarts.
    updateLocalStateRef.current('lastActivity', now);
    // Supabase-only write — skips the RTDB heartbeat and its CF fan-out.
    setLastActivity().catch(() => {});
  }, []);



  // ✅ FIXED: Memoize fetchStockData to prevent contextValue from changing every render
  // This was causing ALL 80+ useGlobalState consumers to re-render on every cycle
  const fetchStockData = useCallback(async (refresh) => {
    try {
      setLoading(true);

      const ls = localStateRef.current;
      const lastActivity = ls.lastActivity ? new Date(ls.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;
      const EXPIRY_LIMIT = refresh ? 1 * 1000 : 3 * 60 * 1000; // 10s for refresh, 6min default
      const shouldFetch =
        timeElapsed > EXPIRY_LIMIT ||
        !ls.data ||
        !Object.keys(ls.data).length ||
        !ls.imgurl;


      if (shouldFetch) {
        const valuesNotGG = `https://adoptme.b-cdn.net?cb=${Date.now()}`;

        // 🔹 Fetch non-GG data from Bunny CDN ONLY (no Firebase fallback)
        try {
          // console.log('🌐 Fetching non-GG data from:', valuesNotGG);
          const res = await fetch(valuesNotGG, {
            method: 'GET',
            cache: 'no-store',
          });
          const json = await res.json();

          if (!json || typeof json !== 'object' || json.error || !Object.keys(json).length) {
            throw new Error('Non-GG CDN returned invalid data');
          }
          // console.log(JSON.stringify(json))
          await updateLocalStateRef.current('data', json);
        } catch (err) {
          console.warn('⚠️ Non-GG CDN failed, using cached data:', err.message);
          // ✅ OPTIMIZED: Use cached data instead of downloading from Firebase xlsData
          // This prevents downloading 12.43 MB from Firebase RTDB
          // If no cached data exists, keep existing localState.data (empty or old)
          const localDataObj = typeof ls.data === 'string' ? JSON.parse(ls.data) : ls.data;
          const hasLocalData = localDataObj && Object.keys(localDataObj || {}).length > 0;

          if (!hasLocalData) {
            console.error('❌ No CDN data and no cached data available. App may not function correctly.');
            // Keep existing localState.data (which might be empty)
            // Don't download from Firebase to save costs
          } else {
            console.log('✅ Using cached data instead of downloading from Firebase xlsData');
          }
        }



        // 🔹 Fetch shared image_url only if missing (essentially static config)
        if (!ls.imgurl) {
          const imageSnapShot = await get(ref(appdatabase, 'image_url'));
          if (imageSnapShot.exists()) {
            await updateLocalStateRef.current('imgurl', imageSnapShot.val());
          }
        }
        // console.log('updated everything')
      }
    } catch (error) {
      // console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
  }, [appdatabase]); // ✅ Stable — only changes if appdatabase changes (once)

  // ✅ Run the function only if needed
  useEffect(() => {
    const id = requestIdleCallback(() => {
      fetchStockData();
    });

    return () => cancelIdleCallback(id);
  }, [fetchStockData]);

  const reload = useCallback(() => {
    fetchStockData(true);
  }, [fetchStockData]);



  // ✅ Track Firebase RTDB WebSocket connection state globally.
  // Exposed so chat screens can warn users on WiFi networks that block WebSockets
  // before a send attempt — instead of showing a generic error after the fact.
  // Starts as `true` (optimistic) so app launch doesn't briefly block sends while
  // Firebase completes its first handshake.
  useEffect(() => {
    if (!appdatabase) return;
    const connectedRef = ref(appdatabase, '.info/connected');
    const unsub = onValue(connectedRef, (snap) => {
      setIsRTDBConnected(snap.val() === true);
    });
    return () => unsub();
  }, [appdatabase]);

  // Warm the authoritative server-time offset early (and again whenever the
  // app returns to foreground — the user may have changed the clock while
  // backgrounded). The synchronous serverNowMs()/getServerTimeQuick() helpers
  // (translation daily cap, cosmetic countdowns) read this cached offset, and
  // the ban listeners only probe when a ban actually exists — so without this,
  // a never-banned user's offset would stay cold and those sync paths would
  // fall back to the raw device clock.
  useEffect(() => {
    if (!appdatabase) return;
    const probeUid = user?.id || 'anon';
    warmServerTime(appdatabase, probeUid);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') warmServerTime(appdatabase, probeUid);
    });
    return () => sub.remove();
  }, [appdatabase, user?.id]);

  // Email-side ban listener — server-time-validated so a banned user can't
  // roll their device clock backward to bypass the gate. `bannedUntil` is
  // compared against authoritative server time (getServerTime probe), and a
  // setTimeout (monotonic, immune to wall-clock changes) auto-clears when
  // the ban actually expires. AppState 'active' triggers a re-probe so a
  // user who changes the clock while backgrounded still gets re-evaluated.
  useEffect(() => {
    if (!currentUserEmail || !appdatabase) {
      setIsEmailBanned(false);
      setStrikeInfo(null);
      return;
    }

    const encodedEmail = currentUserEmail.replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email/${encodedEmail}`);

    let currentBan = null;
    let expiryTimer = null;
    let cancelled = false;

    const evaluate = async () => {
      if (cancelled) return;
      const banData = currentBan;
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

      if (!banData) {
        setIsEmailBanned(false);
        return;
      }
      const { bannedUntil } = banData;
      if (bannedUntil === 'permanent') {
        setIsEmailBanned(true);
        return;
      }
      if (typeof bannedUntil !== 'number') {
        setIsEmailBanned(false);
        return;
      }

      const probeUid = user?.id || currentUserEmail;
      const serverNow = (await getServerTime(appdatabase, probeUid)).getTime();
      if (cancelled) return;
      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) {
        setIsEmailBanned(false);
        return;
      }
      setIsEmailBanned(true);
      // Cap the timer at ~24h so long bans don't sit on a stale offset.
      const wait = Math.min(remaining, 24 * 60 * 60 * 1000);
      expiryTimer = setTimeout(evaluate, wait);
    };

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      currentBan = banData || null;
      setStrikeInfo(currentBan);
      evaluate();
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') evaluate();
    });

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      appStateSub.remove();
      unsubscribe();
    };
  }, [currentUserEmail, appdatabase, user?.id]);

  // Device-side ban listener. Closes the "ban the email, sign up with a
  // fresh one on the same device" bypass. banned_devices entries are
  // written by banUserwithEmail / setUserStrike when a user is banned,
  // and removed by unbanUserWithEmail. Server-time-validated for the
  // same reason as the email listener above.
  useEffect(() => {
    if (!appdatabase) {
      setIsDeviceBanned(false);
      return;
    }

    let unsub = null;
    let cancelled = false;
    let currentBan = null;
    let expiryTimer = null;
    let appStateSub = null;

    const evaluate = async () => {
      if (cancelled) return;
      const data = currentBan;
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

      if (!data) {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      const { bannedUntil } = data;
      if (bannedUntil === 'permanent') {
        setIsDeviceBanned(true);
        setDeviceBanInfo(data);
        return;
      }
      if (typeof bannedUntil !== 'number') {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      const probeUid = user?.id || data?.userId || 'anon';
      const serverNow = (await getServerTime(appdatabase, probeUid)).getTime();
      if (cancelled) return;
      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      setIsDeviceBanned(true);
      setDeviceBanInfo(data);
      const wait = Math.min(remaining, 24 * 60 * 60 * 1000);
      expiryTimer = setTimeout(evaluate, wait);
    };

    getDeviceFingerprint().then((fp) => {
      if (cancelled || !fp) {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      const deviceBanRef = ref(appdatabase, `banned_devices/${fp}`);
      unsub = onValue(deviceBanRef, (snapshot) => {
        currentBan = snapshot.val() || null;
        evaluate();
      });
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') evaluate();
      });
    }).catch(() => {
      setIsDeviceBanned(false);
      setDeviceBanInfo(null);
    });

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      if (appStateSub) appStateSub.remove();
      if (unsub) unsub();
    };
  }, [appdatabase, user?.id]);

  // ✅ Set up online status tracking using separate presence node (RTDB-only, optimized for scale)
  // ✅ Foreground-only presence (ACTIVE = online, background/inactive = offline)
  // ✅ Uses presence/{uid} instead of users/{uid}/online for better scalability
  // ✅ FIXED: Added throttling to prevent RejectedExecutionException from thread pool exhaustion
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const uid = user.id;
    const presenceRef = ref(appdatabase, `presence/${uid}`); // ✅ Separate presence node
    const connectedRef = ref(appdatabase, ".info/connected")

    let isConnected = false;
    let currentAppState = AppState.currentState; // 'active' | 'background' | 'inactive'
    let armedOnDisconnect = false;
    let lastUpdateTime = 0; // ✅ For throttling
    const THROTTLE_MS = 500; // ✅ Minimum 500ms between presence updates

    const setLocalOnline = (val) => {
      setUser((prev) => (prev?.id ? { ...prev, online: val } : prev));
    };

    const forceOffline = async () => {
      try {
        await set(presenceRef, false);
      } catch (e) {
        // log if you want: console.log("forceOffline error", e);
      }
      setLocalOnline(false);
    };

    let onDisconnectHandler = null;

    const armOnDisconnect = async () => {
      if (armedOnDisconnect) return;
      try {
        onDisconnectHandler = onDisconnect(presenceRef);
        await onDisconnectHandler.set(false);
        armedOnDisconnect = true;
      } catch (e) {
        // Handle error silently
      }
    };

    let running = false;
    let pending = false;

    const updatePresence = async () => {
      // ✅ THROTTLE: Prevent rapid-fire updates that cause thread pool exhaustion
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) {
        // Schedule a delayed update instead of firing immediately
        if (!pending) {
          pending = true;
          setTimeout(() => {
            pending = false;
            lastUpdateTime = Date.now();
            updatePresence();
          }, THROTTLE_MS);
        }
        return;
      }
      lastUpdateTime = now;

      if (running) {
        pending = true;
        return;
      }
      running = true;

      try {
        if (localState?.showOnlineStatus === false) {
          try {
            if (onDisconnectHandler) {
              await onDisconnectHandler.cancel();
            }
          } catch { }
          armedOnDisconnect = false;
          await forceOffline();
          return;
        }

        if (!isConnected || currentAppState !== "active") {
          await forceOffline();
          return;
        }

        await armOnDisconnect();
        await set(presenceRef, true);
        setLocalOnline(true);

      } catch (e) {
        // console.log("updatePresence error", e);
      } finally {
        running = false;

        // ✅ if something changed while we were running, apply latest state once more
        if (pending) {
          pending = false;
          // ✅ Use setTimeout to prevent synchronous recursion (thread pool issue)
          setTimeout(updatePresence, 100);
        }
      }
    };



    // Listen to RTDB connection state - wrapped in try-catch to prevent crashes
    const unsubConnected = onValue(connectedRef, (snap) => {
      try {
        isConnected = snap.val() === true;
        updatePresence();
      } catch (e) {
        // ✅ FIXED: Catch errors to prevent RejectedExecutionException crash
        console.warn('Presence update error (ignored):', e?.message || e);
      }
    });

    // Listen to AppState changes
    const sub = AppState.addEventListener("change", (nextState) => {
      try {
        currentAppState = nextState;
        // immediately offline when background/inactive
        updatePresence();
      } catch (e) {
        // ✅ FIXED: Catch errors to prevent crash
        console.warn('AppState presence error (ignored):', e?.message || e);
      }
    });

    // Initial sync
    updatePresence();

    return () => {
      // ✅ Cleanup: Mark user offline when component unmounts or user.id changes (logout)
      sub.remove();
      if (typeof unsubConnected === "function") unsubConnected();

      // ✅ Cancel onDisconnect handler if it exists
      if (onDisconnectHandler) {
        onDisconnectHandler.cancel().catch(() => { });
      }

      // ✅ Mark offline in RTDB (using closure to capture the old uid)
      // This ensures when user.id changes to null (logout), the previous user is marked offline
      set(presenceRef, false).catch(() => { });
      setLocalOnline(false);
    };
  }, [user?.id, appdatabase, localState?.showOnlineStatus]);



  // console.log(user)

  const contextValue = useMemo(
    () => ({
      user, auth,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      updateLocalStateAndDatabase,
      fetchStockData,
      loading,
      freeTranslation,
      isAdmin,
      reload,
      robloxUsernameRef, api, currentUserEmail, single_offer_wall, tradingServerLink,
      isInActiveGame, // ✅ Game state for invite notifications
      setIsInActiveGame, // ✅ Set game state
      acceptedInviteRoom, // ✅ Accepted invite from toast
      setAcceptedInviteRoom, // ✅ Set accepted invite
      isRTDBConnected, // ✅ Firebase RTDB WebSocket connection state
      strikeInfo, // ban payload from banned_users_by_email — used for displaying ban reason/duration
      deviceBanInfo, // device-side ban payload — carries originating email/userId
      isUserBlocked, // canonical gate: email-ban OR device-ban
      worldCupEnabled, // World Cup feature kill switch (RTDB /worldcup_enabled)
      modControlsEnabled, // moderator ban/mute kill switch (RTDB /mod_controls_enabled)
      canGrantJmd, // delegated "can make Junior Mods" grant (RTDB /jmd_granters/{uid})
    }),
    [user, theme, loading, robloxUsernameRef, api, freeTranslation, currentUserEmail, tradingServerLink, isInActiveGame, acceptedInviteRoom, isRTDBConnected, strikeInfo, deviceBanInfo, isUserBlocked, worldCupEnabled, modControlsEnabled, canGrantJmd]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


