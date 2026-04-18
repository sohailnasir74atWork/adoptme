import React, { useCallback, useEffect, useMemo } from 'react';
import { Image, TouchableOpacity, View, Text, Modal, FlatList, StyleSheet, Platform } from 'react-native';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../Homescreen/HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';

import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import DesignUploader from '../Design/DesignMainScreen';
import DesignStack from '../Design/DesignNavigation';
import HomeTabScreen from '../HomeTab/HomeTabScreen';
import CustomTopTabs from '../ValuesScreen/TopTabs';
import { setAppLanguage, loadLanguage } from '../../i18n';
import { syncMyCosmetics, setCachedUsername, setCachedAvatar } from '../Helper/cosmeticsCache';
import { useNavigation } from '@react-navigation/native';
import { checkDailyStreak } from '../ChatScreen/GroupChat/badgeUtils';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';


const Tab = createBottomTabNavigator();

const AnimatedTabIcon = React.memo(({ iconName, color, size, focused, isDark }) => {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (focused) {
      scale.value = withSequence(
        withSpring(1.35, { damping: 3, stiffness: 300 }),
        withSpring(1.15, { damping: 8, stiffness: 180 })
      );
      rotate.value = withSequence(
        withTiming(8, { duration: 80 }),
        withTiming(-8, { duration: 80 }),
        withTiming(4, { duration: 60 }),
        withTiming(0, { duration: 60 })
      );
    } else {
      scale.value = withSpring(1, { damping: 15, stiffness: 150 });
      rotate.value = withTiming(0, { duration: 150 });
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <FontAwesome
        name={iconName}
        size={size}
        color={color}
        solid={focused}
      />
    </Animated.View>
  );
});


// ✅ PERF: Extracted TabBarButton to avoid recreating inline component on every render
const TabBarButton = React.memo(({ onPress, children, isSelected, isDarkMode, tabBarButtonStyles }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.9}
    style={{
      ...tabBarButtonStyles.base,
      backgroundColor: isSelected
        ? (isDarkMode ? tabBarButtonStyles.selected.dark : tabBarButtonStyles.selected.light)
        : 'transparent',
    }}
  >
    {children}
  </TouchableOpacity>
));

const MainTabs = React.memo(({ selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { t, i18n } = useTranslation();
  const { isAdmin, user, theme, appdatabase } = useGlobalState();

  // 🔥 Daily login streak check + cosmetics sync (fire-and-forget)
  useEffect(() => {
    if (user?.id && appdatabase) {
      checkDailyStreak(appdatabase, user.id);
      syncMyCosmetics(appdatabase, user.id, true); // force=true on app start
      if (user.displayName) setCachedUsername(user.displayName);
      if (user.avatar) setCachedAvatar(user.avatar);
    }
  }, [user?.id, appdatabase]);

  // ── Set Android system navigation bar color to match theme ──
  useEffect(() => {
    if (Platform.OS === 'android') {
      const bg = theme === 'dark' ? '#0f172a' : '#ffffff';
      SystemNavigationBar.setNavigationColor(bg, theme === 'dark' ? 'light' : 'dark');
    }
  }, [theme]);





  // ✅ Memoize icons object to avoid recreation
  const icons = useMemo(() => ({
    Home: ['house', 'house'],
    Calculator: ['calculator', 'calculator'],
    Stock: ['cart-shopping', 'cart-shopping'],
    Trade: ['handshake', 'handshake'],
    Chat: ['envelope', 'envelope'],
    Designs: ['house-chimney-crack', 'house-chimney-crack'],
    More: ['angles-right', 'angles-right'],
  }), []);

  const getTabIcon = useCallback((routeName, focused) => {
    return icons[routeName] ? (focused ? icons[routeName][0] : icons[routeName][1]) : 'alert-circle-outline';
  }, [icons]);

  // ✅ Memoize isDarkMode to avoid recalculation
  const isDarkMode = useMemo(() => theme === 'dark', [theme]);

  // ✅ Memoize headerRight component — only Admin trophy
  const headerRight = useCallback((navigation) => (
    <>
      {isAdmin && (
        <TouchableOpacity onPress={() => navigation.navigate('Admin')}>
          <Image
            source={require('../../assets/trophy.webp')}
            style={{ width: 20, height: 20, marginRight: 16 }}
          />
        </TouchableOpacity>
      )}
    </>
  ), [isAdmin]);





  // ✅ Memoize tabBarButton styles
  const tabBarButtonStyles = useMemo(() => ({
    selected: {
      dark: '#5c4c49',
      light: '#f3d0c7',
    },
    base: {
      flex: 1,
      borderRadius: 12,
      marginHorizontal: 4,
      marginVertical: 2,
      justifyContent: 'center',
      alignItems: 'center',
    },
  }), []);


  // ✅ PERF: Memoize screenOptions — prevents recreation on every render cycle
  const screenOptions = useCallback(({ route }) => ({
    tabBarIcon: ({ focused }) => (
      <AnimatedTabIcon
        focused={focused}
        iconName={getTabIcon(route.name, focused)}
        color={focused ? config.colors.primary : (isDarkMode ? '#64748b' : '#94a3b8')}
        size={18}
        isDark={isDarkMode}
      />
    ),
    tabBarButton: (props) => (
      <TabBarButton
        onPress={props.onPress}
        isSelected={props?.['aria-selected']}
        isDarkMode={isDarkMode}
        tabBarButtonStyles={tabBarButtonStyles}
      >
        {props.children}
      </TabBarButton>
    ),
    tabBarStyle: {
      backgroundColor: selectedTheme.colors.background,
      paddingTop: 4,
    },
    tabBarLabelStyle: {
      fontSize: 9,
      fontWeight: 'bold',
    },
    tabBarActiveTintColor: config.colors.primary,
    tabBarInactiveTintColor: isDarkMode ? '#64748b' : '#94a3b8',
    headerStyle: {
      backgroundColor: selectedTheme.colors.background,
    },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontWeight: 'bold', fontSize: 24 },
    lazy: true, // ✅ PERF: Only mount tab screen when first visited
    animation: 'fade',
    animationDuration: 200,
  }), [isDarkMode, selectedTheme, getTabIcon, tabBarButtonStyles]);

  // ✅ PERF: Memoize all tab children with useCallback to prevent remounting on tab switch
  const renderHome = useCallback(() => <HomeTabScreen selectedTheme={selectedTheme} />, [selectedTheme]);
  const renderCalculator = useCallback(() => <HomeScreen selectedTheme={selectedTheme} />, [selectedTheme]);
  const renderTrade = useCallback(() => (
    <TradeStack
      selectedTheme={selectedTheme}
      setChatFocused={setChatFocused}
      modalVisibleChatinfo={modalVisibleChatinfo}
      setModalVisibleChatinfo={setModalVisibleChatinfo}
    />
  ), [selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo]);
  const renderDesigns = useCallback(() => <DesignStack selectedTheme={selectedTheme} />, [selectedTheme]);
  const renderChat = useCallback(() => (
    <ChatStack
      selectedTheme={selectedTheme}
      setChatFocused={setChatFocused}
      modalVisibleChatinfo={modalVisibleChatinfo}
      setModalVisibleChatinfo={setModalVisibleChatinfo}
    />
  ), [selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo]);
  const renderMore = useCallback(() => <CustomTopTabs selectedTheme={selectedTheme} />, [selectedTheme]);

  return (
    <>
      <Tab.Navigator screenOptions={screenOptions}>
        <Tab.Screen
          name="Home"
          options={({ navigation }) => ({
            title: t('tabs.home'),
            headerShown: false,
          })}
        >
          {renderHome}
        </Tab.Screen>

        <Tab.Screen
          name="Calculator"
          options={({ navigation }) => ({
            title: t('tabs.calculator'),
            headerRight: () => headerRight(navigation),
          })}
        >
          {renderCalculator}
        </Tab.Screen>



        <Tab.Screen
          name="Trade"
          options={{
            headerShown: false,
            title: t('tabs.trade'), // Translation applied here
          }}
        >
          {renderTrade}
        </Tab.Screen>
        <Tab.Screen
          name="Designs"
          options={{
            title: t('tabs.feed'), // Translation applied here
            headerShown: false
          }}
        >
          {renderDesigns}
        </Tab.Screen>

        <Tab.Screen
          name="Chat"
          options={{
            headerShown: false,
            title: t('tabs.chat'), // Translation applied here
            tabBarBadge: chatFocused ? "" : null,
            tabBarBadgeStyle: {
              maxWidth: 4,
              height: 8,
              borderRadius: 4,
              fontSize: 10,

              color: 'white',
            },
          }}
        >
          {renderChat}
        </Tab.Screen>


        <Tab.Screen
          name="More"
          options={{
            title: t('tabs.more'), // Translation applied here
            headerShown: false,
          }}
        >
          {renderMore}
        </Tab.Screen>

      </Tab.Navigator>
    </>
  );
});

export default MainTabs;
