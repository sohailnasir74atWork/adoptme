import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { ensureGoogleSignInConfigured } from './googleSignInConfig';
import { markSignOutIntent } from './signOutIntent';
import Icon from 'react-native-vector-icons/FontAwesome';
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import { requestPermission } from '../Helper/PermissionCheck';
import { setPendingSigninChoice, clearPendingSigninChoice } from '../Helper/emailOptIn';
import { handleOpenPrivacy, handleOpenTerms } from '../SettingScreen/settinghelper';
// import { showMessage } from 'react-native-flash-message';

import { getApp } from '@react-native-firebase/app';
import {
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  AppleAuthProvider,
  signOut,
  onAuthStateChanged,
} from '@react-native-firebase/auth';

// Map Firebase Auth error codes to translated, user-friendly messages.
// Falls back to a generic message for unmapped codes — keeps users from
// seeing raw "Firebase: Error (auth/network-request-failed)..." strings.
const getFirebaseAuthErrorMessage = (error, t) => {
  switch (error?.code) {
    case 'auth/invalid-email': return t('signin.error_invalid_email_format');
    case 'auth/user-disabled': return t('signin.error_user_disabled');
    case 'auth/user-not-found': return t('signin.error_user_not_found');
    case 'auth/wrong-password': return t('signin.error_wrong_password');
    case 'auth/invalid-credential': return t('signin.error_invalid_credential');
    case 'auth/email-already-in-use': return t('signin.error_email_in_use');
    case 'auth/weak-password': return t('signin.error_weak_password');
    case 'auth/too-many-requests': return t('signin.error_too_many_requests');
    default: return t('signin.error_signin_message');
  }
};

// Renders a translated sentence whose linked words are wrapped in tags, e.g.
// "By continuing, you agree to our <terms>Terms</terms> and <privacy>Privacy
// Policy</privacy>." Translators get the whole sentence and can move the
// tagged words wherever their grammar needs them; each tag becomes a tappable
// nested <Text> calling handlers[tag]. A tag with no handler renders as plain
// text, and a sentence with no tags renders unchanged.
const renderLinkedSentence = (sentence, handlers, linkStyle) => {
  const parts = [];
  const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let match;
  while ((match = tagRe.exec(sentence)) !== null) {
    if (match.index > last) parts.push(sentence.slice(last, match.index));
    const [, tag, label] = match;
    const onPress = handlers[tag];
    parts.push(onPress
      ? <Text key={`${tag}-${match.index}`} style={linkStyle} onPress={onPress}>{label}</Text>
      : label);
    last = tagRe.lastIndex;
  }
  if (last < sentence.length) parts.push(sentence.slice(last));
  return parts;
};

// Detect "user changed their mind" cancellations from Apple/Google sign-in
// sheets so we don't show a scary error toast for what's just a dismiss.
const isUserCancellation = (error) => {
  if (!error) return false;
  const code = String(error.code || '');
  // Google: SIGN_IN_CANCELLED. Apple: '1001' (appleAuth.Error.CANCELED).
  return code === statusCodes.SIGN_IN_CANCELLED || code === '1001';
};

const SignInDrawer = ({ visible, onClose, selectedTheme, message, screen }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);            // Google / reset
  const [isLoadingSecondary, setIsLoadingSecondary] = useState(false); // email/pass
  const [robloxUsernameError, setRobloxUsernameError] = useState('');
  const [robloxUsernamelocal, setRobloxUsernamelocal] = useState();
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);
  // Email news-and-updates opt-in. Must start unticked: a pre-ticked box is
  // not valid consent under GDPR/UK law. Applied by EmailOptInGate after
  // sign-in, which also runs the 13+ check.
  const [emailUpdates, setEmailUpdates] = useState(false);
  // Consent is per sign-in: a tick left from an earlier, abandoned attempt
  // must not carry over, so the box resets whenever the drawer closes.
  useEffect(() => { if (!visible) setEmailUpdates(false); }, [visible]);

  const { triggerHapticFeedback } = useHaptic();
  const { theme, robloxUsernameRef, user } = useGlobalState();
  const { t } = useTranslation();

  // 🔐 Modular Auth instance
  const app = getApp();
  const auth = getAuth(app);

  // Opened while Firebase already holds a session whose profile is still
  // loading (a slow login after the 3 s splash cap): this player IS signed in,
  // so show "loading your account" instead of the sign-in form, and close by
  // itself once the profile lands. Decided when the drawer opens only, so a
  // sign-in that starts inside the drawer is never affected.
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    setRestoring(visible && !!auth.currentUser && !user?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => {
    if (restoring && user?.id) {
      setRestoring(false);
      onClose?.();
    }
  }, [restoring, user?.id, onClose]);
  useEffect(() => {
    if (!restoring) return undefined;
    // The session went away instead (e.g. unverified email): show the form.
    return onAuthStateChanged(auth, (u) => { if (!u) setRestoring(false); });
  }, [restoring, auth]);

  const isDarkMode = theme === 'dark';

  // Signs out an email/password user who has not verified yet. GlobelStats'
  // backstop also signs such users out if they are still signed in 3 s after
  // signing in, which a slow email send can outlast, and RNFB's signOut()
  // rejects with auth/no-current-user when nobody is signed in. Uncaught, that
  // swapped the "check your inbox" modal for "Failed to sign in" (2026-09-29).
  const signOutUnverified = async (reason) => {
    if (!auth.currentUser) return;
    markSignOutIntent(reason);
    try {
      await signOut(auth);
    } catch (e) {
      if (e?.code !== 'auth/no-current-user') throw e;
    }
  };

  useEffect(() => {
    robloxUsernameRef.current = robloxUsernamelocal;
  }, [robloxUsernamelocal, robloxUsernameRef]);

  useEffect(() => {
    // Shared, idempotent config (GlobelStats also needs it for silent re-login).
    ensureGoogleSignInConfigured();
  }, []);

  useEffect(() => {
    if (!appleAuth.isSupported) return;

    return appleAuth.onCredentialRevoked(async () => {
      try {
        markSignOutIntent('apple-revoked');
        await signOut(auth);
        showWarningMessage(t('signin.session_expired_title'), t('signin.session_expired_message'));
      } catch (e) {
        console.error('Error during signOut on Apple revoke:', e);
      }
    });
  }, [auth]);

  const handleForgotPassword = async () => {
    triggerHapticFeedback('impactLight');
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      showErrorMessage(t('home.alert.error'), t('signin.enter_valid_email'));
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(trimmedEmail)) {
      showErrorMessage(t('home.alert.error'), t('signin.error_invalid_email'));
      return;
    }

    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
    } catch (error) {
      // Intentionally swallow Firebase errors here, including
      // auth/user-not-found. Surfacing them would let an attacker
      // enumerate which emails have accounts. Worst case a network
      // failure shows "email sent" but nothing arrives — the user can
      // tap the button again and we'll retry.
      console.warn('[forgot-password] suppressed:', error?.message);
    } finally {
      setIsLoading(false);
    }

    // Always show the same generic success regardless of outcome.
    showSuccessMessage(t('home.alert.success'), t('signin.password_reset_email_sent'));
    setIsForgotPasswordMode(false);
  };

  const onAppleButtonPress = useCallback(async () => {
    triggerHapticFeedback('impactLight');
    setPendingSigninChoice(emailUpdates);

    try {
      const { identityToken, nonce } = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      });

      if (!identityToken) throw new Error(t('signin.error_apple_token'));

      const appleCredential = AppleAuthProvider.credential(identityToken, nonce);
      await signInWithCredential(auth, appleCredential);

      showSuccessMessage(t('home.alert.success'), t('signin.success_signin'));
      setTimeout(onClose, 200);
      await requestPermission();
    } catch (error) {
      // Keep the choice if sign-in itself went through and only a later
      // step (the notification permission request) threw.
      if (!auth.currentUser) clearPendingSigninChoice();
      if (isUserCancellation(error)) return; // user dismissed sheet — don't toast
      showErrorMessage(
        t('home.alert.error'),
        getFirebaseAuthErrorMessage(error, t)
      );
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen, emailUpdates]);

  const handleSignInOrRegister = async () => {
    triggerHapticFeedback('impactLight');

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      showErrorMessage(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(trimmedEmail)) {
      showErrorMessage(t('home.alert.error'), t('signin.error_invalid_email'));
      return;
    }

    // 🚫 Block disposable / temp email domains
    const TEMP_EMAIL_DOMAINS = new Set([
      'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
      'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info', 'grr.la',
      'sharklasers.com', 'guerrillamailblock.com', 'spam4.me', 'trashmail.com',
      'trashmail.at', 'trashmail.io', 'trashmail.me', 'trashmail.net', 'trashmail.org',
      'trashmail.xyz', 'mailnull.com', 'spamgourmet.com', 'yopmail.com', 'yopmail.fr',
      'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj',
      'speed.1s.fr', 'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf',
      'monmail.fr.nf', 'tempmail.com', 'tempmail.net', 'tempmail.org', 'temp-mail.org',
      'temp-mail.io', 'dispostable.com', 'throwam.com', 'owlpic.com', 'fakeinbox.com',
      'mailnesia.com', 'maildrop.cc', 'discard.email', 'spambog.com', 'spamfree24.org',
      'getairmail.com', 'filzmail.com', 'anon-mail.de', 'rhyta.com', 'spamday.com',
      'maileater.com', 'mailexpire.com', 'mailsac.com', 'mailslite.com', 'mailzilla.org',
      'deadaddress.com', 'harakirimail.com', 'slopsbox.com', 'trbvm.com',
      'trashmailer.com', 'wegwerfmail.de', 'yopmail.pp.ua',
    ]);
    if (isRegisterMode) {
      const emailDomain = trimmedEmail.toLowerCase().split('@')[1];
      if (TEMP_EMAIL_DOMAINS.has(emailDomain)) {
        showErrorMessage(
          t('home.alert.error'),
          t('signin.error_disposable_email')
        );
        return;
      }
    }

    setIsLoadingSecondary(true);

    try {
      if (isRegisterMode) {
        // Registration signs straight back out; the choice applies at sign-in.
        clearPendingSigninChoice();
        // 🔐 Register new user
        const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        const user = userCredential.user;

        // Send verification email then sign out
        await user.sendEmailVerification();
        await signOutUnverified('register-verify-email');

        // Blocking modal — user must acknowledge to know they need to
        // check their inbox before signing in.
        Alert.alert(
          t('signin.account_created_title'),
          t('signin.account_created_message')
        );
        return;
      } else {
        // 🔐 Login existing user
        setPendingSigninChoice(emailUpdates);
        const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          clearPendingSigninChoice();
          await user.sendEmailVerification();
          await signOutUnverified('login-unverified');

          // Blocking modal — user must acknowledge they need to verify.
          Alert.alert(
            t('signin.email_not_verified_title'),
            t('signin.email_not_verified_message')
          );
          return;
        }

        showSuccessMessage(t('signin.alert_welcome_back'), t('signin.success_signin'));
        await requestPermission();
        setTimeout(onClose, 200);
      }
    } catch (error) {
      // Keep the choice if sign-in itself went through and only a later
      // step (the notification permission request) threw.
      if (!auth.currentUser) clearPendingSigninChoice();
      console.error(t('signin.auth_error'), error);
      showErrorMessage(
        t('home.alert.error'),
        getFirebaseAuthErrorMessage(error, t)
      );
    } finally {
      setIsLoadingSecondary(false);
    }
  };

  const handleGoogleSignIn = useCallback(async () => {
    triggerHapticFeedback('impactLight');

    setPendingSigninChoice(emailUpdates);
    try {
      setIsLoading(true);
      ensureGoogleSignInConfigured();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // 2026-09-04: drop any cached Google account first. After a silent native
      // sign-out (token revoked / auth store lost) the library kept returning
      // the same expired idToken, so signInWithCredential failed with
      // "invalid credentials" until the user cleared app data.
      await GoogleSignin.signOut().catch(() => {});
      const signInResult = await GoogleSignin.signIn();
      if (signInResult?.type === 'cancelled') { clearPendingSigninChoice(); return; } // user dismissed the sheet
      const idToken = signInResult?.idToken || signInResult?.data?.idToken;
      if (!idToken) throw new Error(t('signin.error_signin_message'));

      const googleCredential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, googleCredential);

      showSuccessMessage(t('signin.alert_welcome_back'), t('signin.success_signin'));
      setTimeout(onClose, 200);
      await requestPermission();
    } catch (error) {
      // Keep the choice if sign-in itself went through and only a later
      // step (the notification permission request) threw.
      if (!auth.currentUser) clearPendingSigninChoice();
      if (isUserCancellation(error)) return; // user dismissed sheet — don't toast
      showErrorMessage(
        t('home.alert.error'),
        getFirebaseAuthErrorMessage(error, t)
      );
    } finally {
      setIsLoading(false);
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen, emailUpdates]);

  if (visible && restoring) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={styles.modalOverlay} onPress={onClose} />
        <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
          <View style={styles.restoringBox}>
            <ActivityIndicator size="large" color={isDarkMode ? '#fff' : '#333'} />
            <Text style={[styles.text, { color: selectedTheme.colors.text, marginTop: 12 }]}>{t('signin.restoring')}</Text>
          </View>
        </SwipeableBottomDrawer>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <ConditionalKeyboardWrapper>
        <Pressable onPress={() => { }}>
          <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
            <Text style={[styles.title, { color: selectedTheme.colors.text }]}>
              {isRegisterMode
                ? t('signin.title_register')
                : isForgotPasswordMode
                  ? t('signin.title_reset_password')
                  : t('signin.title_signin')}
            </Text>

            <View>
              <Text style={[styles.text, { color: selectedTheme.colors.text }]}>{message}</Text>
            </View>

            {/* Email / Password fields */}
            {!isForgotPasswordMode && (
              <>
                <TextInput
                  style={[styles.input, { color: selectedTheme.colors.text }]}
                  placeholder={t('signin.placeholder_email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={selectedTheme.colors.text}
                />

                <TextInput
                  style={[styles.input, { color: selectedTheme.colors.text }]}
                  placeholder={t('signin.placeholder_password')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholderTextColor={selectedTheme.colors.text}
                />
              </>
            )}

            {isForgotPasswordMode && (
              <TextInput
                style={[styles.input, { color: selectedTheme.colors.text }]}
                placeholder={t('signin.placeholder_email')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={selectedTheme.colors.text}
              />
            )}

            <TouchableOpacity
              style={[styles.secondaryButton, { alignItems: 'flex-end', paddingBottom: 10 }]}
              onPress={() => setIsForgotPasswordMode(!isForgotPasswordMode)}
            >
              <Text style={styles.secondaryButtonText}>
                {isForgotPasswordMode ? t('signin.back_to_sign_in') : t('signin.forgot_password')}
              </Text>
            </TouchableOpacity>

            {!isForgotPasswordMode && (
              <TouchableOpacity
                style={styles.optInRow}
                onPress={() => setEmailUpdates((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: emailUpdates }}
              >
                <View style={[styles.checkbox, emailUpdates && styles.checkboxChecked]}>
                  {emailUpdates && <Icon name="check" size={12} color="white" />}
                </View>
                <Text style={[styles.optInText, { color: selectedTheme.colors.text }]}>
                  {t('signin.email_updates_optin', { defaultValue: 'Email me news and updates (optional)' })}
                </Text>
              </TouchableOpacity>
            )}

            {isForgotPasswordMode ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleForgotPassword}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.primaryButtonText}>{t('signin.button_send_reset_link')}</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSignInOrRegister}
                disabled={isLoadingSecondary}
              >
                {isLoadingSecondary ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isRegisterMode ? t('signin.title_register') : t('signin.title_signin')}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.container}>
              <View style={styles.line} />
              <Text style={[styles.textoR, { color: selectedTheme.colors.text }]}>
                {t('signin.or')}
              </Text>
              <View style={styles.line} />
            </View>

            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleSignIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Icon name="google" size={20} color="white" style={styles.googleIcon} />
                  <Text style={styles.googleButtonText}>{t('signin.google_signin')}</Text>
                </>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <AppleButton
                buttonStyle={
                  isDarkMode ? AppleButton.Style.WHITE : AppleButton.Style.BLACK
                }
                buttonType={AppleButton.Type.SIGN_IN}
                style={styles.applebUUTON}
                onPress={() =>
                  onAppleButtonPress().then(() =>
                    console.log('Apple sign-in complete!')
                  )
                }
              />
            )}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                if (!isForgotPasswordMode) {
                  setIsRegisterMode(!isRegisterMode);
                }
              }}
            >
              <Text style={styles.secondaryButtonText}>
                {isRegisterMode
                  ? t('signin.button_switch_signin')
                  : t('signin.button_switch_register')}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.legalText, { color: selectedTheme.colors.text }]}>
              {renderLinkedSentence(
                t('signin.legal_agree'),
                { terms: handleOpenTerms, privacy: handleOpenPrivacy },
                styles.legalLink,
              )}
            </Text>
          </SwipeableBottomDrawer>
        </Pressable>
      </ConditionalKeyboardWrapper>
    </Modal>
  );
};

const styles = StyleSheet.create({
  optInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'grey',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#007BFF',
    borderColor: '#007BFF',
  },
  optInText: {
    flex: 1,
    fontSize: 13,
  },
  legalText: {
    fontSize: 11,
    textAlign: 'center',
    opacity: 0.7,
    marginBottom: 16,
    lineHeight: 16,
  },
  legalLink: {
    textDecorationLine: 'underline',
  },
  restoringBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawer: {
    paddingHorizontal: 20,
    paddingTop: 0,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 40,
    borderColor: 'grey',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginTop: 15,
  },
  primaryButton: {
    backgroundColor: '#007BFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  secondaryButton: {
    padding: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#007BFF',
    textDecorationLine: 'underline',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DB4437',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    height: 40,
  },
  applebUUTON: {
    height: 40,
    width: '100%',
  },
  googleIcon: {
    marginRight: 10,
  },
  googleButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  text: {
    alignSelf: 'center',
    fontSize: 12,
    paddingVertical: 3,
    marginBottom: 10,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#ccc',
  },
  textoR: {
    marginHorizontal: 10,
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 12,
    marginTop: 5,
    marginLeft: 5,
  },
});

export default SignInDrawer;
