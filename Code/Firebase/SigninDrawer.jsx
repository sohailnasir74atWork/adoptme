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
        showWarningMessage('Session Expired', 'Please sign in again.');
      } catch (e) {
        console.error('Error during signOut on Apple revoke:', e);
      }
    });
  }, [auth]);

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert(t('home.alert.error'), 'Enter valid email address');
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

    setIsLoadingSecondary(true);

    try {
      if (isRegisterMode) {
        // 🔐 Register new user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          await user.sendEmailVerification();
          await signOut(auth);

          Alert.alert(
            '✅ Account Created',
            "Please check your inbox to verify your email. If you don't see it, check the Spam or Promotions folder."
          );
          return;
        }
      } else {
        // 🔐 Login existing user
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          await user.sendEmailVerification();
          await signOut(auth);

          Alert.alert(
            '📩 Email Not Verified',
            'A new verification link has been sent to your email. Please check your inbox or spam folder before signing in.'
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
      else if (error?.code === 'auth/email-already-in-use') errorMessage = t('signin.error_email_in_use');
      else if (error?.code === 'auth/weak-password') errorMessage = t('signin.error_weak_password');

      Alert.alert(t('signin.error_signin_message'), errorMessage);
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
        <Pressable onPress={() => {}}>
          <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
            <Text style={[styles.title, { color: selectedTheme.colors.text }]}>
              {isRegisterMode
                ? t('signin.title_register')
                : isForgotPasswordMode
                ? 'Forget Password'
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
                {isForgotPasswordMode ? 'Signin Mode' : 'Forgetpassword Mode'}
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
                  <Text style={styles.primaryButtonText}>Send Reset Link</Text>
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
          </View>
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
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    paddingHorizontal: 20,
    paddingTop: 20,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Lato-Bold',
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
    fontFamily: 'Lato-Bold',
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
    fontFamily: 'Lato-Bold',
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
    fontFamily: 'Lato-Bold',
  },
  errorText: {
    fontSize: 12,
    marginTop: 5,
    marginLeft: 5,
  },
});

export default SignInDrawer;
