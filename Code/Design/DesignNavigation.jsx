import React, { useMemo, useState, useCallback } from 'react';
import { Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';

import DesignFeedScreen from './DesignMainScreen';
import PrivateChatScreen from '../ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from '../ChatScreen/PrivateChat/PrivateChatHeader';
import ImageViewerScreen from './componenets/ImageViewer';

const Stack = createNativeStackNavigator();

const HighlightedText = ({ text }) => (
  <Text style={styles.highlightedText}>{text}</Text>
);

export const DesignStack = ({ selectedTheme }) => {
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const openDrawer = useCallback(() => setIsDrawerVisible(true), []);
  const closeDrawer = useCallback(() => setIsDrawerVisible(false), []);
  // console.log('dsignnavigator')

  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
  }), [selectedTheme]);

  const sharedParams = useMemo(() => ({
    bannedUsers,
    selectedTheme,
  }), [bannedUsers, selectedTheme]);

  const getPrivateChatOptions = useCallback(
    ({ route }) => {
      const { selectedUser, isOnline } = route.params || {};
      return {
        headerTitle: () => (
          <PrivateChatHeader
            selectedUser={selectedUser}
            isOnline={isOnline}
            selectedTheme={selectedTheme}
            bannedUsers={bannedUsers}
            setBannedUsers={setBannedUsers}
            triggerHapticFeedback={triggerHapticFeedback}
            setIsDrawerVisible={setIsDrawerVisible}
            
            openDrawer={openDrawer}   // ✅ add this
          />
        ),
      };
    },
    [selectedTheme, bannedUsers, triggerHapticFeedback, openDrawer]
  );

  return (
    <Stack.Navigator screenOptions={headerOptions}>
    <Stack.Screen
      name="DesignScreen"
      component={DesignFeedScreen}
      initialParams={sharedParams}
      options={{ title: 'Feed' }}
    />

    <Stack.Screen name="PrivateChatDesign" options={getPrivateChatOptions}>
      {(props) => (
        <PrivateChatScreen
          {...props}
          bannedUsers={bannedUsers}
          isDrawerVisible={isDrawerVisible}
          setIsDrawerVisible={setIsDrawerVisible}
          closeProfileDrawer={closeDrawer} // ✅ optional convenience prop
        />
      )}
    </Stack.Screen>

    <Stack.Screen
      name="ImageViewerScreen"
      component={ImageViewerScreen}
      options={{ title: 'Image' }}
    />
  </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  highlightedText: {
    fontFamily: 'Lato-Bold',
    color: config.colors.primary,
  },
});

export default React.memo(DesignStack);
