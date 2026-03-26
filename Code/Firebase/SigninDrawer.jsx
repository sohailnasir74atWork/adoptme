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
import { GoogleSignin } from '@react-native-google-signin/google-signin';
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
  signInWithPhoneNumber,
} from '@react-native-firebase/auth';

const SignInDrawer = ({ visible, onClose, selectedTheme, message, screen }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
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

  // Reset phone verification state
  const resetPhoneState = () => {
    setPhoneNumber('');
    setOtpCode('');
    setConfirmationResult(null);
    setOtpSent(false);
  };

  const handleSendOtp = async () => {
    const cleaned = phoneNumber.trim();
    if (!cleaned || cleaned.length < 7) {
      Alert.alert(t('home.alert.error'), 'Please enter a valid phone number with country code (e.g. +1234567890)');
      return;
    }
    setIsSendingOtp(true);
    try {
      const result = await signInWithPhoneNumber(auth, cleaned);
      setConfirmationResult(result);
      setOtpSent(true);
      showSuccessMessage('Code Sent', `Verification code sent to ${cleaned}`);
    } catch (error) {
      showErrorMessage(t('home.alert.error'), error?.message || 'Failed to send SMS. Check the number and try again.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert(t('home.alert.error'), t('signin.enter_valid_email'));
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(email)) {
      Alert.alert(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      showSuccessMessage(t('home.alert.success'), t('signin.password_reset_email_sent'));
      setIsForgotPasswordMode(false);
    } catch (error) {
      showErrorMessage(
        t('home.alert.error'),
        error?.message || t('signin.error_reset_password')
      );
    } finally {
      setIsLoading(false);
    }
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
      showErrorMessage(
        t('home.alert.error'),
        error?.message || t('signin.error_signin_message')
      );
    }
  }, [auth, t, triggerHapticFeedback, onClose, screen]);

  const handleSignInOrRegister = async () => {
    triggerHapticFeedback('impactLight');

    if (!email || !password) {
      Alert.alert(t('home.alert.error'), t('signin.error_input_message'));
      return;
    }

    const isValidEmail = (em) => /\S+@\S+\.\S+/.test(em);
    if (!isValidEmail(email)) {
      Alert.alert(t('home.alert.error'), t('signin.error_input_message'));
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
      const emailDomain = email.toLowerCase().split('@')[1];
      if (TEMP_EMAIL_DOMAINS.has(emailDomain)) {
        Alert.alert(
          t('home.alert.error'),
          'Temporary or disposable email addresses are not allowed. Please use a real email address (Gmail, Outlook, Yahoo, etc.).'
        );
        return;
      }
    }

    setIsLoadingSecondary(true);

    try {
      if (isRegisterMode) {
        // Step 1: Verify phone OTP first
        if (!confirmationResult || !otpSent) {
          Alert.alert(t('home.alert.error'), 'Please verify your phone number first.');
          setIsLoadingSecondary(false);
          return;
        }
        try {
          await confirmationResult.confirm(otpCode.trim());
        } catch {
          Alert.alert(t('home.alert.error'), 'Invalid verification code. Please try again.');
          setIsLoadingSecondary(false);
          return;
        }

        // 🔐 Register new user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Send verification email then sign out
        await user.sendEmailVerification();
        await signOut(auth);

        Alert.alert(
          t('signin.account_created_title'),
          t('signin.account_created_message')
        );
        resetPhoneState();
        return;
      } else {
        // 🔐 Login existing user
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          await user.sendEmailVerification();
          await signOut(auth);

          Alert.alert(
            t('signin.email_not_verified_title'),
            t('signin.email_not_verified_message')
          );
          return;
        }

        mixpanel.track(`Login with email from ${screen}`);
        Alert.alert(t('signin.alert_welcome_back'), t('signin.success_signin'));
        await requestPermission();
        setTimeout(onClose, 200);
      }
    } catch (error) {
      console.error(t('signin.auth_error'), error);

      let errorMessage = t('signin.error_signin_message');

      if (error?.code === 'auth/invalid-email') errorMessage = t('signin.error_invalid_email_format');
      else if (error?.code === 'auth/user-disabled') errorMessage = t('signin.error_user_disabled');
      else if (error?.code === 'auth/user-not-found') errorMessage = t('signin.error_user_not_found');
      else if (error?.code === 'auth/wrong-password') errorMessage = t('signin.error_wrong_password');
      else if (error?.code === 'auth/invalid-credential') errorMessage = t('signin.error_invalid_credential');
      else if (error?.code === 'auth/email-already-in-use') errorMessage = t('signin.error_email_in_use');
      else if (error?.code === 'auth/weak-password') errorMessage = t('signin.error_weak_password');
      else if (error?.code === 'auth/too-many-requests') errorMessage = t('signin.error_too_many_requests'); // Optional if you have it, else fallback

      Alert.alert(t('signin.error_auth'), errorMessage);
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
      showErrorMessage(
        t('home.alert.error'),
        error?.message || t('signin.error_signin_message')
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

            {/* ── Phone verification — register mode only ── */}
            {isRegisterMode && !isForgotPasswordMode && (
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        flex: 1, marginTop: 0, color: selectedTheme.colors.text,
                        borderColor: otpSent ? '#29AB87' : 'grey'
                      },
                    ]}
                    placeholder="+1234567890 (with country code)"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    keyboardType="phone-pad"
                    editable={!otpSent}
                    placeholderTextColor={selectedTheme.colors.text}
                  />
                  <TouchableOpacity
                    onPress={otpSent ? () => { setOtpSent(false); setConfirmationResult(null); setOtpCode(''); } : handleSendOtp}
                    disabled={isSendingOtp}
                    style={{
                      backgroundColor: otpSent ? '#555' : '#29AB87',
                      paddingHorizontal: 12, paddingVertical: 10,
                      borderRadius: 6, alignItems: 'center',
                    }}
                  >
                    {isSendingOtp
                      ? <ActivityIndicator size="small" color="white" />
                      : <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
                          {otpSent ? 'Resend' : 'Send Code'}
                        </Text>
                    }
                  </TouchableOpacity>
                </View>

                {otpSent && (
                  <View style={{ marginTop: 8 }}>
                    <TextInput
                      style={[styles.input, { marginTop: 0, color: selectedTheme.colors.text, borderColor: '#29AB87' }]}
                      placeholder="Enter 6-digit code"
                      value={otpCode}
                      onChangeText={setOtpCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      placeholderTextColor={selectedTheme.colors.text}
                    />
                    <Text style={{ fontSize: 11, color: '#29AB87', marginTop: 4 }}>
                      ✅ Code sent! Enter it above then tap Register.
                    </Text>
                  </View>
                )}
              </View>
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
                  resetPhoneState();
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
