// navigationService.js — Global navigation ref for use outside NavigationContainer
// Used by GlobalInviteToast to navigate after accepting game invites
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}
