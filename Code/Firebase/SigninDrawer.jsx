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
import Icon from 'react-native-vector-icons/FontAwesome';
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import { requestPermission } from '../Helper/PermissionCheck';
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

  const { triggerHapticFeedback } = useHaptic();
  const { theme, robloxUsernameRef } = useGlobalState();
  const { t } = useTranslation();

  // 🔐 Modular Auth instance
  const app = getApp();
  const auth = getAuth(app);

  const isDarkMode = theme === 'dark';

  useEffect(() => {
    robloxUsernameRef.current = robloxUsernamelocal;
  }, [robloxUsernamelocal, robloxUsernameRef]);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '541413670501-aj1f61kv0k9f3v515tsu3768ef9hpfjt.apps.googleusercontent.com',
      offlineAccess: true,
    });
  }, []);

  useEffect(() => {
    if (!appleAuth.isSupported) return;

    return appleAuth.onCredentialRevoked(async () => {
      try {
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
      showErrorMessage(t('home.alert.error'), t('signin.error_input_message'));
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
      mixpanel.track(`Login with apple from ${screen}`);
      await requestPermission();
    } catch (error) {
      if (isUserCancellation(error)) return; // user dismissed sheet — don't toast
      showErrorMessage(
        t('home.alert.error'),
        getFirebaseAuthErrorMessage(error, t)
      );
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen]);

  const handleSignInOrRegister = async () => {
    triggerHapticFeedback('impactLight');

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      showErrorMessage(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(trimmedEmail)) {
      showErrorMessage(t('home.alert.error'), t('signin.error_input_message'));
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
          'Temporary or disposable email addresses are not allowed. Please use a real email address (Gmail, Outlook, Yahoo, etc.).'
        );
        return;
      }
    }

    setIsLoadingSecondary(true);

    try {
      if (isRegisterMode) {
        // 🔐 Register new user
        const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        const user = userCredential.user;

        // Send verification email then sign out
        await user.sendEmailVerification();
        await signOut(auth);

        // Blocking modal — user must acknowledge to know they need to
        // check their inbox before signing in.
        Alert.alert(
          t('signin.account_created_title'),
          t('signin.account_created_message')
        );
        return;
      } else {
        // 🔐 Login existing user
        const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          await user.sendEmailVerification();
          await signOut(auth);

          // Blocking modal — user must acknowledge they need to verify.
          Alert.alert(
            t('signin.email_not_verified_title'),
            t('signin.email_not_verified_message')
          );
          return;
        }

        mixpanel.track(`Login with email from ${screen}`);
        showSuccessMessage(t('signin.alert_welcome_back'), t('signin.success_signin'));
        await requestPermission();
        setTimeout(onClose, 200);
      }
    } catch (error) {
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

    try {
      setIsLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult?.idToken || signInResult?.data?.idToken;
      if (!idToken) throw new Error(t('signin.error_signin_message'));

      const googleCredential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, googleCredential);

      showSuccessMessage(t('signin.alert_welcome_back'), t('signin.success_signin'));
      setTimeout(onClose, 200);
      mixpanel.track(`Login with google from ${screen}`);
      await requestPermission();
    } catch (error) {
      if (isUserCancellation(error)) return; // user dismissed sheet — don't toast
      showErrorMessage(
        t('home.alert.error'),
        getFirebaseAuthErrorMessage(error, t)
      );
    } finally {
      setIsLoading(false);
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen]);

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
                  ? t('signin.title_forget_password')
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
                {isForgotPasswordMode ? t('signin.mode_signin') : t('signin.mode_forget_password')}
              </Text>
            </TouchableOpacity>

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
          </SwipeableBottomDrawer>
        </Pressable>
      </ConditionalKeyboardWrapper>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
