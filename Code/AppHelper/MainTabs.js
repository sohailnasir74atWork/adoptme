import React, { useCallback, useMemo } from 'react';
import { Image, TouchableOpacity, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../Homescreen/HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
// import TimerScreen from '../StockScreen/TimerScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import DesignUploader from '../Design/DesignMainScreen';
import DesignStack from '../Design/DesignNavigation';
import CustomTopTabs from '../ValuesScreen/TopTabs';



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
  const { t } = useTranslation();
  const { isAdmin, user, theme } = useGlobalState();

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

  // ✅ Memoize headerRight component to prevent re-renders
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
  ), [isAdmin, user?.id, user?.avatar]);

  // ✅ Memoize isDarkMode to avoid recalculation
  const isDarkMode = useMemo(() => theme === 'dark', [theme]);

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
          // height: 50,
          backgroundColor: selectedTheme.colors.background,
        },
        tabBarLabelStyle: {
          fontSize: 9, // 👈 Your custom label font size
          fontFamily: 'Lato-Bold', // Optional: Custom font family
          color: config.colors.primary,

        },
        tabBarActiveTintColor: config.colors.primary,
        tabBarInactiveTintColor: selectedTheme.colors.text,
        headerStyle: {
          backgroundColor: selectedTheme.colors.background,
        },
        headerTintColor: selectedTheme.colors.text,
        headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
      })}
    >
      <Tab.Screen
        name="Calculator"
        options={({ navigation }) => ({
          title: t('tabs.calculator'),
          headerRight: () => headerRight(navigation),
        })}
      >
        {() => <HomeScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

      {/* <Tab.Screen
        name="Stock"
        options={{
          title: t('tabs.stock'), // Translation applied here
        }}
      >
        {() => <TimerScreen selectedTheme={selectedTheme} />}
      </Tab.Screen> */}

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
          title: 'Feed', // Translation applied here
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
            // backgroundColor: 'red',
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
          title: 'More', // Translation applied here
          headerShown: false,
        }}
      >
        {() => <CustomTopTabs selectedTheme={selectedTheme} />}
      </Tab.Screen>

    </Tab.Navigator>
  );
});

export default MainTabs;
