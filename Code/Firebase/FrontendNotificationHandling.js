// Code/Firebase/FrontendNotificationHandling.js

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { getMessaging, onMessage, onNotificationOpenedApp, getInitialNotification } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { useLocalState } from '../LocalGlobelStats';
import i18n from '../../i18n';
import { openPushRoute } from '../Helper/navigationService';
import { onSquadPush } from '../Helper/squad';

// ✅ Messaging instance for default app
const messaging = getMessaging();

// A tap that cold-started the app is delivered once; don't replay it when the
// effect below re-runs (it re-subscribes whenever the block list changes).
let initialTapHandled = false;

const NotificationHandler = () => {
  const { localState } = useLocalState();

  useEffect(() => {
    const setup = async () => {
      try {
        // Android: create channel once
        if (Platform.OS === 'android') {
          await notifee.createChannel({
            id: 'default',
            // Shown in Android's system notification settings.
            name: i18n.t('misc.notification_channel_name'),
            importance: AndroidImportance.HIGH,
            smallIcon: 'ic_notification',
            color: '#36454F',
            pressAction: { id: 'default' },
          });
        }
      } catch (error) {
        // console.error('[Notification] createChannel error:', error);
      }
    };

    setup();

    let isProcessingNotification = false;

    const processNotification = async (remoteMessage) => {
      if (!remoteMessage) {
        // console.warn('[Notification] remoteMessage is null/undefined');
        return;
      }

      // console.log('[FCM] Received message in foreground:', remoteMessage);

      if (isProcessingNotification) {
        // console.warn('[Notification] Already processing, skipping…');
        return;
      }

      isProcessingNotification = true;

      try {
        const { notification, data } = remoteMessage || {};
        const title = notification?.title || data?.title || null;
        const body = notification?.body || data?.body || null;
        const senderId = data?.senderId;
        const type = data?.taype;

        // ✅ Filter out notifications from blocked users (client-side only)
        if (senderId) {
          const bannedUsersList = Array.isArray(localState?.bannedUsers) ? localState.bannedUsers : [];
          if (bannedUsersList.includes(senderId)) {
            // console.log('[Notification] Sender is banned, skipping:', senderId);
            return; // Skip notification - user is blocked
          }
        }

        if (!title || !body) {
          // console.warn('[Notification] Incomplete payload:', remoteMessage);
          return;
        }

        let notificationTitle = title;
        let notificationBody = body;

        if (type === 'selectedFruits') {
          // keep as is
        } else if (type === 'stockUpdate') {
          notificationTitle = i18n.t('misc.stock_update_title');
          notificationBody = i18n.t('misc.stock_update_body');
        }

        // ✅ Display notification after current interactions finish to avoid blocking UI
        requestIdleCallback(async () => {
          await notifee.displayNotification({
            title: notificationTitle,
            body: notificationBody,
            android: {
              channelId: 'default',
              smallIcon: 'ic_notification',
              color: '#36454F',
              pressAction: { id: 'default' },
            },
            ...(data?.route ? { data: { route: String(data.route) } } : {}),
          });
        }, { timeout: 1000 });
      } catch (error) {
        // console.error('[Notification] Error processing notification:', error);
      } finally {
        isProcessingNotification = false;
      }
    };

    // ✅ Foreground listener (modular)
    const unsubscribeForeground = onMessage(messaging, async (remoteMessage) => {
      if (remoteMessage?.data?.type === 'squad') onSquadPush(remoteMessage.data.kind);
      await processNotification(remoteMessage);
    });

    // ✅ Handle Notifee notification clicks (foreground)
    const unsubscribeNotifee = notifee.onForegroundEvent(
      async ({ type, detail }) => {
        if (type === EventType.PRESS) {
          const route = detail?.notification?.data?.route;
          if (route) openPushRoute(route);
        }
      },
    );

    // ✅ Taps on system-tray pushes (app in background / killed)
    const unsubscribeOpened = onNotificationOpenedApp(messaging, (remoteMessage) => {
      if (remoteMessage?.data?.type === 'squad') onSquadPush(remoteMessage.data.kind);
      const route = remoteMessage?.data?.route;
      if (route) openPushRoute(route);
    });
    if (!initialTapHandled) {
      initialTapHandled = true;
      getInitialNotification(messaging)
        .then((remoteMessage) => {
          if (remoteMessage?.data?.type === 'squad') onSquadPush(remoteMessage.data.kind);
          const route = remoteMessage?.data?.route;
          if (route) openPushRoute(route);
        })
        .catch(() => {});
    }

    return () => {
      unsubscribeForeground();
      unsubscribeNotifee();
      unsubscribeOpened();
    };
  }, [localState?.bannedUsers]);

  return null;
};

export default NotificationHandler;
