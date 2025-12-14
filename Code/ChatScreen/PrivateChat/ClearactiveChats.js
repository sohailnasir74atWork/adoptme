import {  useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BackHandler } from 'react-native';
import database from '@react-native-firebase/database';

// ✅ Add validation for clearActiveChat
const clearActiveChat = async (userId) => {
  // ✅ Safety check
  if (!userId || typeof userId !== 'string') {
    console.warn('⚠️ Invalid userId for clearActiveChat');
    return;
  }

  try {
    const db = database();
    if (!db) {
      console.error('❌ Database instance not available');
      return;
    }
    await db.ref(`/activeChats/${userId}`).remove();
  } catch (error) {
    console.error(`❌ Failed to clear active chat for user ${userId}:`, error);
  }
};

export const useActiveChatHandler = (userId, chatId) => {
  const navigation = useNavigation();

  // ✅ Memoized function to set active chat with validation
  const setActiveChat = useCallback(async () => {
    // ✅ Safety checks
    if (!userId || typeof userId !== 'string') {
      console.warn('⚠️ Invalid userId for setActiveChat');
      return;
    }

    if (!chatId || typeof chatId !== 'string') {
      console.warn('⚠️ Invalid chatId for setActiveChat');
      return;
    }

    try {
      const db = database();
      if (!db) {
        console.error('❌ Database instance not available');
        return;
      }
      await db.ref(`/activeChats/${userId}`).set(chatId);
    } catch (error) {
      console.error(`❌ Failed to set active chat for user ${userId}:`, error);
    }
  }, [userId, chatId]);

  // Memoized back handler
  const onBackPress = useCallback(() => {
    clearActiveChat(userId);
    navigation.goBack();
    return true; // Prevent default back press behavior
  }, [userId, navigation]);

  useFocusEffect(
    useCallback(() => {
      // ✅ Only set active chat if userId and chatId are valid
      if (userId && chatId) {
        setActiveChat();
      }

      // ✅ Store the back handler subscription for proper cleanup
      const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => {
        if (userId) {
          clearActiveChat(userId);
        }
        // ✅ Remove the event listener using the subscription
        if (backHandler && typeof backHandler.remove === 'function') {
          backHandler.remove();
        } else {
          BackHandler.removeEventListener('hardwareBackPress', onBackPress);
        }
      };
    }, [setActiveChat, onBackPress, userId, chatId])
  );
};
