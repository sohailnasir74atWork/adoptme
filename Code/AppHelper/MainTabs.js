import React, { useCallback, useMemo, useState } from 'react';
import { Image, TouchableOpacity, View, Text, Modal, FlatList, StyleSheet, Platform } from 'react-native';
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
import CustomTopTabs from '../ValuesScreen/TopTabs';
import { setAppLanguage, loadLanguage, AVAILABLE_LANGUAGES } from '../../i18n';
import { useNavigation } from '@react-navigation/native';



const Tab = createBottomTabNavigator();

const AnimatedTabIcon = React.memo(({ iconName, color, size, focused }) => {
  return (
    <FontAwesome
      name={iconName}
      size={size}
      color={color}
      solid={focused}
    />
  );
});


const MainTabs = React.memo(({ selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { t, i18n } = useTranslation();
  const { isAdmin, user, theme } = useGlobalState();
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  // ✅ Get current language code (e.g. 'en')
  const currentLang = i18n.language || 'en';
  const currentLangData = AVAILABLE_LANGUAGES.find(l => l.code === currentLang) || AVAILABLE_LANGUAGES[0];

  // ✅ Handle language change
  const handleLanguageChange = async (langCode) => {
    await loadLanguage(langCode);
    await setAppLanguage(langCode);
    setShowLanguageModal(false);
  };

  // ✅ Memoize icons object to avoid recreation
  const icons = useMemo(() => ({
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

  // ✅ Analytics button component (reused in headerLeft on iOS, headerRight on Android)
  const AnalyticsButton = useCallback((navigation) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('Analytics')}
      style={{
        marginRight: Platform.OS === 'ios' ? 0 : 12,
        marginLeft: Platform.OS === 'ios' ? 10 : 0,
        paddingHorizontal: 8,
        paddingVertical: 4,
        position: 'relative',
      }}
    >
      <FontAwesome name="chart-line" size={18} color={config.colors.primary} solid />
      <View style={{
        position: 'absolute',
        top: -6,
        right: -10,
        backgroundColor: '#EF4444',
        borderRadius: 6,
        paddingVertical: 1,
        minWidth: 30,
        alignItems: 'center',
      }}>
        <Text style={{ color: '#fff', fontSize: 7, fontWeight: 'semi-bold' }}>NEW</Text>
      </View>
    </TouchableOpacity>
  ), []);

  // ✅ On iOS, place Analytics button on the left (header title is centered)
  const headerLeft = useCallback((navigation) => (
    Platform.OS === 'ios' ? AnalyticsButton(navigation) : null
  ), [AnalyticsButton]);

  // ✅ Memoize headerRight component to prevent re-renders
  const headerRight = useCallback((navigation) => (
    <>
      {/* Analytics Button — only on Android (iOS uses headerLeft) */}
      {Platform.OS !== 'ios' && AnalyticsButton(navigation)}

      {/* Language Selector Button */}
      <TouchableOpacity
        onPress={() => setShowLanguageModal(true)}
        style={{
          marginRight: 12,
          paddingHorizontal: 8,
          paddingVertical: 4,
          backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
          borderRadius: 6,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 14, marginRight: 4 }}>{currentLangData.flag}</Text>
        <Text style={{
          fontSize: 12,
          fontWeight: 'bold',
          color: isDarkMode ? '#fff' : '#333',
          textTransform: 'uppercase',
        }}>
          {currentLang}
        </Text>
      </TouchableOpacity>

      {isAdmin && (
        <TouchableOpacity onPress={() => navigation.navigate('Admin')}>
          <Image
            source={require('../../assets/trophy.webp')}
            style={{ width: 20, height: 20, marginRight: 16 }}
          />
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => navigation.navigate('Setting')} style={{ marginRight: 16 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            borderWidth: 2,
            borderColor: config.colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            source={{ uri: !user?.id ? 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png' : user.avatar }}
            style={{ width: 28, height: 28, borderRadius: 12.5 }}
          />
        </View>
      </TouchableOpacity>
    </>
  ), [isAdmin, user?.id, user?.avatar, isDarkMode, currentLangData.flag, currentLang]);

  // ✅ Language Modal Component
  const LanguageModal = () => (
    <Modal
      visible={showLanguageModal}
      transparent={true}
      animationType="fade"
      onRequestClose={() => setShowLanguageModal(false)}
    >
      <TouchableOpacity
        style={langStyles.overlay}
        activeOpacity={1}
        onPress={() => setShowLanguageModal(false)}
      >
        <View style={[langStyles.modal, { backgroundColor: isDarkMode ? '#1e293b' : '#fff' }]}>
          <Text style={[langStyles.title, { color: isDarkMode ? '#fff' : '#000' }]}>
            {t('settings.select_language')}
          </Text>
          <FlatList
            data={AVAILABLE_LANGUAGES}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  langStyles.langItem,
                  item.code === currentLang && { backgroundColor: config.colors.primary + '20' },
                ]}
                onPress={() => handleLanguageChange(item.code)}
              >
                <Text style={langStyles.flag}>{item.flag}</Text>
                <Text style={[langStyles.langName, { color: isDarkMode ? '#fff' : '#000' }]}>
                  {item.name}
                </Text>
                {item.code === currentLang && (
                  <Icon name="checkmark-circle" size={20} color={config.colors.primary} />
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );



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


  return (
    <>
      <LanguageModal />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => (
            <AnimatedTabIcon
              focused={focused}
              iconName={getTabIcon(route.name, focused)}
              color={config.colors.primary}
              size={18}
            />
          ),
          tabBarButton: (props) => {
            const { onPress, children } = props;
            const isSelected = props?.['aria-selected'];

            return (
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
            );
          },

          tabBarStyle: {
            backgroundColor: selectedTheme.colors.background,
          },
          tabBarLabelStyle: {
            fontSize: 9, // 👈 Your custom label font size
            fontWeight: 'bold', // Optional: Custom font family
            color: config.colors.primary,

          },
          tabBarActiveTintColor: config.colors.primary,
          tabBarInactiveTintColor: selectedTheme.colors.text,
          headerStyle: {
            backgroundColor: selectedTheme.colors.background,
          },
          headerTintColor: selectedTheme.colors.text,
          headerTitleStyle: { fontWeight: 'bold', fontSize: 24 },
        })}
      >
        <Tab.Screen
          name="Calculator"
          options={({ navigation }) => ({
            title: t('tabs.calculator'),
            headerLeft: () => headerLeft(navigation),
            headerRight: () => headerRight(navigation),
          })}
        >
          {() => <HomeScreen selectedTheme={selectedTheme} />}
        </Tab.Screen>



        <Tab.Screen
          name="Trade"
          options={{
            headerShown: false,
            title: t('tabs.trade'), // Translation applied here
          }}
        >
          {() => (
            <TradeStack
              selectedTheme={selectedTheme}
              setChatFocused={setChatFocused}
              modalVisibleChatinfo={modalVisibleChatinfo}
              setModalVisibleChatinfo={setModalVisibleChatinfo}
            />
          )}
        </Tab.Screen>
        <Tab.Screen
          name="Designs"
          options={{
            title: t('tabs.feed'), // Translation applied here
            headerShown: false
          }}
        >
          {() => <DesignStack selectedTheme={selectedTheme} />}
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
          {() => (
            <ChatStack
              selectedTheme={selectedTheme}
              setChatFocused={setChatFocused}
              modalVisibleChatinfo={modalVisibleChatinfo}
              setModalVisibleChatinfo={setModalVisibleChatinfo}
            />
          )}
        </Tab.Screen>


        <Tab.Screen
          name="More"
          options={{
            title: t('tabs.more'), // Translation applied here
            headerShown: false,
          }}
        >
          {() => <CustomTopTabs selectedTheme={selectedTheme} />}
        </Tab.Screen>

      </Tab.Navigator>
    </>
  );
});

// ✅ Language Selector Styles
const langStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: '80%',
    maxHeight: '70%',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  flag: {
    fontSize: 24,
    marginRight: 12,
  },
  langName: {
    flex: 1,
    fontSize: 16,

  },
});

export default MainTabs;
