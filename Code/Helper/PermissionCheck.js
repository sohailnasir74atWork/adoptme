import notifee from '@notifee/react-native';
import { Alert, Linking } from 'react-native';
import i18n from '../../i18n';




export const requestPermission = async () => {
  try {
    const settings = await notifee.requestPermission();
    if (
      settings.authorizationStatus == 0
    ) {
      Alert.alert(
        i18n.t('settings.permission_required'),
        i18n.t('settings.notification_permissions_disabled'),
        [
          { text: i18n.t('home.cancel'), style: 'cancel' },
          {
            text: i18n.t('permissions.go_to_settings'),
            onPress: () => Linking.openSettings(), // Redirect to app settings
          },
        ]
      );
      return false; // Permission not granted
    }

    if (
      settings.authorizationStatus === 1
    ) {
      // console.log('Notification permissions granted:', settings);
      return true; // Permission granted
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    Alert.alert(i18n.t('alert.error'), i18n.t('permissions.notification_request_failed'));
    return false;
  }
};