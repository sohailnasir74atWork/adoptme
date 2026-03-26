import { getApp } from '@react-native-firebase/app';
import {
  getAuth,
  signOut,
  deleteUser as fbDeleteUser,
} from '@react-native-firebase/auth';
import { clearMyCosmetics } from '../Helper/cosmeticsCache';

/**
 * Log out the current user and reset local user state.
 */
export const logoutUser = async (setUser) => {
  try {
    const app = getApp();              // get the default Firebase app
    const auth = getAuth(app);         // get Auth instance for that app

    await signOut(auth);               // modular signOut

    // Clear all MMKV caches (cosmetics, avatar, username, egg data)
    clearMyCosmetics();

    // Reset your global user state
    setUser({
      id: null,
      displayName: '',
      avatar: null,
      isBlock: false,
      fcmToken: null,
      lastactivity: null,
      online: false,
      createdAt: null,
    });
  } catch (error) {
    console.error('🔥 Error logging out:', error?.message || error);
  }
};

/**
 * Delete the currently signed-in user from Firebase Auth.
 * NOTE: This requires a "recent login" or it will throw auth/requires-recent-login.
 */
export const deleteUser = async () => {
  try {
    const app = getApp();
    const auth = getAuth(app);
    const user = auth.currentUser;

    if (user) {
      await fbDeleteUser(user);        // modular deleteUser(user)
    } else {
      console.warn('No user is currently logged in.');
    }
  } catch (error) {
    console.error('Error deleting user:', error?.message || error);
    throw error;
  }
};
