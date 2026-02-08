import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';



const PostsHeader = ({
  selectedTag,
  filterMyPosts,
  setFilterMyPosts,
  setSelectedTag,
  fetchInitialPosts,
  fetchMyPosts,
  fetchPostsByTag,
}) => {
  const { theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const { t } = useTranslation();

  const availableTags = [
    { label: t('feed.tags.scam_alert'), value: 'Scam Alert' },
    { label: t('feed.tags.looking_for_trade'), value: 'Looking for Trade' },
    { label: t('feed.tags.discussion'), value: 'Discussion' },
    { label: t('feed.tags.real_or_fake'), value: 'Real or Fake' },
    { label: t('feed.tags.need_help'), value: 'Need Help' },
    { label: t('feed.tags.misc'), value: 'Misc' }
  ];

  const getLabelForValue = (val) => {
    const found = availableTags.find(t => t.value === val);
    return found ? found.label : val;
  };

  return (
    <Menu>
      <MenuTrigger style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
        <Text style={{ color: config.colors.primary, fontSize: 10, fontWeight: '900', marginRight: 4 }}>
          {getLabelForValue(selectedTag) || ''}
        </Text>
        <FontAwesome
          name="filter"
          size={20}
          style={{ padding: 6 }}
          color={filterMyPosts || selectedTag ? config.colors.primary : isDarkMode ? '#ccc' : '#444'}
        />
      </MenuTrigger>
      <MenuOptions customStyles={{ optionsContainer: { width: 200 } }}>
        {/* All Posts */}
        <MenuOption
          onSelect={() => {
            const handleAction = () => {
              setFilterMyPosts(false);
              setSelectedTag(null);
              fetchInitialPosts();
            };

            if (!localState.isPro) {
              InterstitialAdManager.showAd(handleAction);
            } else {
              handleAction();
            }
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 14, color: !filterMyPosts && !selectedTag ? config.colors.primary : '#333', fontWeight: !filterMyPosts && !selectedTag ? 'bold' : 'normal' }}>
              {t('feed.all_posts')}
            </Text>
            {!filterMyPosts && !selectedTag && <FontAwesome name="check" size={14} color={config.colors.primary} />}
          </View>
        </MenuOption>

        {/* My Posts */}
        <MenuOption
          onSelect={() => {
            const handleAction = () => {
              setFilterMyPosts(true);
              setSelectedTag(null);
              fetchMyPosts();
            };

            if (!localState.isPro) {
              InterstitialAdManager.showAd(handleAction);
            } else {
              handleAction();
            }
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 14, color: filterMyPosts ? config.colors.primary : '#333', fontWeight: filterMyPosts ? 'bold' : 'normal' }}>
              {t('feed.my_posts')}
            </Text>
            {filterMyPosts && <FontAwesome name="check" size={14} color={config.colors.primary} />}
          </View>
        </MenuOption>

        {/* Divider & Label */}
        <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, borderTopWidth: 1, borderColor: '#ccc' }}>
          <Text style={{ fontWeight: 'bold', fontSize: 12, color: isDarkMode ? '#aaa' : '#444', fontWeight: 'bold' }}>
            {t('feed.filter_by_tag')}
          </Text>
        </View>

        {/* Tag Filters */}
        {availableTags.map((tagObj, index) => (
          <MenuOption
            key={index}
            onSelect={() => {
              const handleAction = () => {
                setFilterMyPosts(false);
                setSelectedTag(tagObj.value);
                fetchPostsByTag(tagObj.value);
              };
              if (!localState.isPro) {
                InterstitialAdManager.showAd(handleAction);
              } else {
                handleAction();
              }
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 14, color: selectedTag === tagObj.value ? config.colors.primary : '#333', fontWeight: selectedTag === tagObj.value ? 'bold' : 'normal' }}>
                {tagObj.label}
              </Text>
              {selectedTag === tagObj.value && (
                <FontAwesome name="check" size={14} color={config.colors.primary} />
              )}
            </View>
          </MenuOption>
        ))}
      </MenuOptions>
    </Menu>
  );
};

export default PostsHeader;

