import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,           // ✅ moved here
} from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';

const REVIEWS_PAGE_SIZE = 3; // how many reviews per page

const ProfileBottomDrawer = ({
  isVisible,
  toggleModal,
  startChat,
  selectedUser,
  isOnline,
  bannedUsers,
  fromPvtChat,
}) => {
  const { theme, firestoreDB, appdatabase } = useGlobalState();
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;
  const userName = selectedUser?.sender || null;
  const avatar = selectedUser?.avatar || null;

  // 🔒 ban state - ✅ Safety check for array
  const isBlock = Array.isArray(bannedUsers) && bannedUsers.includes(selectedUserId);

  // ⭐ rating summary (from RTDB /averageRatings)
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [userBio, setUserBio] = useState(null);

  // joined text
  const [createdAtText, setCreatedAtText] = useState(null);

  // 📝 reviews list (from Firestore /reviews where toUserId == selectedUserId)
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [lastReviewDoc, setLastReviewDoc] = useState(null);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);

  // 🐾 pets (owned + wishlist) from Firestore doc /reviews/{userId}
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [loadingPets, setLoadingPets] = useState(false);

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), 'Copied to Clipboard');
    mixpanel.track('Code UserName', { UserName: code });
  };

  // ─────────────────────────────────────────────
  // Open Roblox Profile
  const handleOpenRobloxProfile = useCallback(async () => {
    if (!selectedUser?.robloxUsername && !selectedUser?.robloxUserId) {
      return;
    }

    triggerHapticFeedback('impactLight');

    const robloxUserId = selectedUser?.robloxUserId;
    const robloxUsername = selectedUser?.robloxUsername;

    try {
      // Construct URLs
      let robloxAppUrl = null;
      let robloxWebUrl = null;

      if (robloxUserId) {
        // Use userId for app deep link (most reliable)
        robloxAppUrl = `roblox://users/${robloxUserId}`;
        // Use search URL format for web (works with username)
        robloxWebUrl = robloxUsername 
          ? `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`
          : `https://www.roblox.com/users/${robloxUserId}`;
      } else if (robloxUsername) {
        // Use search URL format with username
        robloxWebUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`;
      }

      if (!robloxWebUrl) {
        Alert.alert('Error', 'Could not open Roblox profile. Missing username or user ID.');
        return;
      }

      // Try to open in Roblox app first (only if we have userId)
      if (robloxAppUrl) {
        try {
          const canOpenApp = await Linking.canOpenURL(robloxAppUrl);
          if (canOpenApp) {
            await Linking.openURL(robloxAppUrl);
            return; // Successfully opened in app
          }
        } catch (appError) {
          console.log('Could not open in Roblox app, falling back to browser:', appError);
        }
      }

      // Fallback to browser with search URL
      await Linking.openURL(robloxWebUrl);
    } catch (error) {
      console.error('Error opening Roblox profile:', error);
      Alert.alert('Error', 'Could not open Roblox profile. Please try again.');
    }
  }, [selectedUser?.robloxUsername, selectedUser?.robloxUserId, triggerHapticFeedback]);

  // ✅ Memoize formatCreatedAt
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffMs = now - timestamp;

    if (diffMs < 0) return null;

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }, []);

  // ✅ Memoize getTimestampMs
  const getTimestampMs = useCallback((ts) => {
    if (!ts) return null;

    // Firestore Timestamp instance
    if (typeof ts.toDate === 'function') {
      return ts.toDate().getTime();
    }

    // { seconds, nanoseconds }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    }

    // already a number?
    if (typeof ts === 'number') return ts;

    return null;
  }, []);

  // ─────────────────────────────────────────────
  // Ban / Unban
  const handleBanToggle = async () => {
    if (!selectedUserId) return;

    const action = isBlock ? t('chat.unblock') : t('chat.block');

    Alert.alert(
      `${action}`,
      `${t('chat.are_you_sure')} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              let updatedBannedUsers;

              // ✅ Safety check for array
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              if (isBlock) {
                updatedBannedUsers = currentBanned.filter(
                  (id) => id !== selectedUserId,
                );
              } else {
                updatedBannedUsers = [...currentBanned, selectedUserId];
              }

              await updateLocalState('bannedUsers', updatedBannedUsers);

              setTimeout(() => {
                showSuccessMessage(
                  t('home.alert.success'),
                  isBlock
                    ? `${userName} ${t('chat.user_unblocked')}`
                    : `${userName} ${t('chat.user_blocked')}`,
                );
              }, 100);
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ],
    );
  };

  // ─────────────────────────────────────────────
  // Start chat
  const handleStartChat = () => {
    if (startChat) startChat();
  };

  // Reset when drawer closes
  useEffect(() => {
    if (!isVisible) {
      setLoadDetails(false);
      setRatingSummary(null);
      setUserBio(null);
      setOwnedPets([]);
      setWishlistPets([]);
      setReviews([]);
      lastReviewDocRef.current = null;
      isLoadingRef.current = false;
      setLastReviewDoc(null);
      setHasMoreReviews(false);
      setCreatedAtText(null);
    }
  }, [isVisible]);

  // ─────────────────────────────────────────────
  // Load rating summary + joined
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadRatingSummary = async () => {
      setLoadingRating(true);
      try {
        const [avgSnap, createdSnap] = await Promise.all([
          get(ref(appdatabase, `averageRatings/${selectedUserId}`)),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
        ]);

        if (!isMounted) return;

        if (avgSnap.exists()) {
          const val = avgSnap.val();
          setRatingSummary({
            value: Number(val.value || 0),
            count: Number(val.count || 0),
          });
          // ✅ Load bio from rating doc
          setUserBio(val.bio || null);
        } else {
          setRatingSummary(null);
          setUserBio(null);
        }

        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            setCreatedAtText(formatCreatedAt(ts));
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }
      } catch (err) {
        console.log('Rating load error:', err);
        if (isMounted) {
          setRatingSummary(null);
          setCreatedAtText(null);
        }
      } finally {
        if (isMounted) setLoadingRating(false);
      }
    };

    loadRatingSummary();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, appdatabase]);

  // ─────────────────────────────────────────────
  // Load pets
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadPets = async () => {
      setLoadingPets(true);
      try {
        const reviewDocSnap = await getDoc(
          doc(firestoreDB, 'reviews', selectedUserId),
        );

        if (!isMounted) return;

        if (reviewDocSnap.exists) {
          const data = reviewDocSnap.data() || {};
          setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
          setWishlistPets(
            Array.isArray(data.wishlistPets) ? data.wishlistPets : [],
          );
        } else {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } catch (err) {
        console.log('Pets load error:', err);
        if (isMounted) {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } finally {
        if (isMounted) setLoadingPets(false);
      }
    };

    loadPets();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, firestoreDB]);

  // ─────────────────────────────────────────────
  // Load reviews (paged) — ✅ Memoized with useCallback
  // ✅ Use refs to track state and avoid dependency issues
  const lastReviewDocRef = useRef(null);
  const isLoadingRef = useRef(false);
  
  const loadReviews = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    
    // ✅ Prevent duplicate calls using ref (avoids dependency issues)
    if (isLoadingRef.current) {
      console.log('🔄 [BottomDrawer] Already loading reviews, skipping...');
      return;
    }

    isLoadingRef.current = true;
    setLoadingReviews(true);
    try {
      // ✅ Fetch one extra document to check if there are more reviews
      // This prevents showing "load more" when there's exactly REVIEWS_PAGE_SIZE reviews
      let q;
      if (!reset && lastReviewDocRef.current) {
        q = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
          orderBy('updatedAt', 'desc'),
          startAfter(lastReviewDocRef.current),
          limit(REVIEWS_PAGE_SIZE + 1), // ✅ Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
          orderBy('updatedAt', 'desc'),
          limit(REVIEWS_PAGE_SIZE + 1), // ✅ Fetch one extra to check if more exist
        );
      }

      const snap = await getDocs(q);

      // ✅ Check if we got more than page size (means there are more reviews)
      const hasMoreResults = snap.docs.length > REVIEWS_PAGE_SIZE;
      
      // ✅ Only take REVIEWS_PAGE_SIZE documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, REVIEWS_PAGE_SIZE);
      
      const batch = docsToUse.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
        };
      });

      setReviews((prev) => (reset ? batch : [...prev, ...batch]));

      // ✅ Use the last document from the actual batch (not the extra one)
      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      lastReviewDocRef.current = newLastDoc;
      setLastReviewDoc(newLastDoc);
      
      // ✅ Fix: hasMoreReviews is true only if we got more results than page size
      // This accurately detects if there are more reviews without false positives
      setHasMoreReviews(hasMoreResults);
    } catch (err) {
      console.log('Reviews load error:', err);
      if (reset) setReviews([]);
      setHasMoreReviews(false);
    } finally {
      isLoadingRef.current = false;
      setLoadingReviews(false);
    }
  }, [firestoreDB, selectedUserId]); // ✅ Removed loadingReviews from deps to prevent re-renders

  // initial reviews load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // reset pagination when details open
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    loadReviews(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]); // ✅ Removed loadReviews from deps to prevent re-renders

  // ✅ Memoize handleLoadMoreReviews
  const handleLoadMoreReviews = useCallback(() => {
    if (!hasMoreReviews || loadingReviews) return;
    loadReviews(false);
  }, [hasMoreReviews, loadingReviews, loadReviews]);

  // ─────────────────────────────────────────────
  // Helpers for rendering - ✅ Memoized

  const renderStars = useCallback((value) => {
    const rounded = Math.round(value || 0);
    const full = '★'.repeat(Math.min(rounded, 5));
    const empty = '☆'.repeat(Math.max(0, 5 - rounded));
    return (
      <Text style={{ color: '#FFD700', fontSize: 14, fontWeight: '600' }}>
        {full}
        <Text style={{ color: '#999' }}>{empty}</Text>
      </Text>
    );
  }, []);

  const renderPetBubble = useCallback((pet, index) => {
    // ✅ Safety checks
    if (!pet || typeof pet !== 'object') return null;

    const valueType = (pet.valueType || 'd').toLowerCase();
    let rarityBg = '#FF6666';
    if (valueType === 'n') rarityBg = '#2ecc71';
    if (valueType === 'm') rarityBg = '#9b59b6';

    return (
      <View
        key={`${pet.id || pet.name || index}-${index}`}
        style={{
          width: 42,
          height: 42,
          marginRight: 6,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: isDarkMode ? '#0f172a' : '#e5e7eb',
        }}
      >
        <Image
          source={{ uri: pet.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={{ width: '100%', height: '100%' }}
        />
        <View
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          {/* Rarity badge */}
          <View
            style={{
              paddingHorizontal: 3,
              paddingVertical: 1,
              borderRadius: 999,
              backgroundColor: rarityBg,
              marginLeft: 2,
            }}
          >
            <Text
              style={{
                fontSize: 8,
                fontWeight: '700',
                color: '#fff',
              }}
            >
              {valueType.toUpperCase()}
            </Text>
          </View>

          {/* Fly badge */}
          {pet.isFly && (
            <View
              style={{
                paddingHorizontal: 3,
                paddingVertical: 1,
                borderRadius: 999,
                backgroundColor: '#3498db',
                marginLeft: 2,
              }}
            >
              <Text
                style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}
              >
                F
              </Text>
            </View>
          )}

          {/* Ride badge */}
          {pet.isRide && (
            <View
              style={{
                paddingHorizontal: 3,
                paddingVertical: 1,
                borderRadius: 999,
                backgroundColor: '#e74c3c',
                marginLeft: 2,
              }}
            >
              <Text
                style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}
              >
                R
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [isDarkMode]);

  // ─────────────────────────────────────────────
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer Content */}
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={styles.drawer}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 480 }}
          >
            {/* HEADER: user row */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: 'row' }}>
                <Image
                  source={{
                    uri: avatar
                      ? avatar
                      : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  }}
                  style={styles.profileImage2}
                />
                <View style={{ justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text style={styles.drawerSubtitleUser}>
                      {userName}{' '}
                      {selectedUser?.isPro && (
                        <Image
                          source={require('../../../assets/pro.png')}
                          style={{ width: 14, height: 14 }}
                        />
                      )}{' '}
                      {selectedUser?.flage ? selectedUser.flage : ''}{'   '}
                    </Text>
                    {selectedUser?.robloxUsername ? (
                      <View style={{ 
                        marginLeft: 6, 
                        backgroundColor: selectedUser?.robloxUsernameVerified ? '#4CAF50' : '#FFA500', 
                        paddingHorizontal: 6, 
                        paddingVertical: 2, 
                        borderRadius: 4,
                      }}>
                        <Text style={{ 
                          color: '#FFFFFF', 
                          fontSize: 9, 
                          fontWeight: '600' 
                        }}>
                          {selectedUser?.robloxUsernameVerified ? '✓ Verified' : '⚠ Unverified'}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ 
                        marginLeft: 6, 
                        backgroundColor: '#9CA3AF', 
                        paddingHorizontal: 6, 
                        paddingVertical: 2, 
                        borderRadius: 4,
                      }}>
                        <Text style={{ 
                          color: '#FFFFFF', 
                          fontSize: 9, 
                          fontWeight: '600' 
                        }}>
                          No Roblox ID
                        </Text>
                      </View>
                    )}
                    <Icon
                      name="copy-outline"
                      size={16}
                      color="#007BFF"
                      style={{ marginLeft: 8 }}
                      onPress={() => copyToClipboard(userName)}
                    />
                  </View>

                  {/* Roblox Username Display */}
                  {selectedUser?.robloxUsername && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: '#00A8FF', // Nice blue color for Roblox
                        marginTop: 4,
                        fontWeight: '500',
                      }}
                    >
                      @{selectedUser.robloxUsername}
                    </Text>
                  )}

                  <Text
                    style={{
                      color: !isOnline
                        ? config.colors.hasBlockGreen
                        : config.colors.wantBlockRed,
                      fontSize: 10,
                      marginTop: 2,
                    }}
                  >
                    {isOnline ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>

              {/* Ban/Unban Icon */}
              <TouchableOpacity onPress={handleBanToggle}>
                <Icon
                  name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'}
                  size={30}
                  color={
                    isBlock
                      ? config.colors.hasBlockGreen
                      : config.colors.wantBlockRed
                  }
                />
              </TouchableOpacity>
            </View>

            {/* ⭐ Rating summary - Below profile picture section */}
            {loadDetails && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 12,
                  marginTop: 8,
                }}
              >
                {loadingRating ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : ratingSummary ? (
                  <>
                    {renderStars(ratingSummary.value)}
                    <Text
                      style={{
                        marginLeft: 6,
                        fontSize: 12,
                        color: isDarkMode ? '#e5e7eb' : '#4b5563',
                      }}
                    >
                      {ratingSummary.value.toFixed(1)} / 5 ·{' '}
                      {ratingSummary.count} rating
                      {ratingSummary.count === 1 ? '' : 's'}
                    </Text>
                  </>
                ) : (
                  <Text
                    style={{
                      fontSize: 12,
                      color: isDarkMode ? '#9ca3af' : '#6b7280',
                    }}
                  >
                    Not rated yet
                  </Text>
                )}

                {!loadingRating && createdAtText && (
                  <Text
                    style={{
                      fontSize: 10,
                      backgroundColor: isDarkMode ? '#FACC15' : '#16A34A',
                      paddingHorizontal: 5,
                      borderRadius: 4,
                      paddingVertical: 1,
                      color: 'white',
                      marginLeft: 5,
                    }}
                  >
                    Joined {createdAtText}
                  </Text>
                )}
              </View>
            )}
     {/* 📝 Bio Section */}
     {loadDetails && userBio && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '500',
                    marginBottom: 6,
                    color: isDarkMode ? '#9ca3af' : '#6b7280',
                  }}
                >
                  Bio
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                    lineHeight: 18,
                  }}
                >
                  {userBio}
                </Text>
              </View>
            )}
            {/* 🐾 Pets section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  Pets
                </Text>

                {loadingPets ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : (
                  <>
                    {/* Owned */}
                    <View style={{ marginBottom: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '500',
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          Owned Pets
                        </Text>
                      </View>

                      {ownedPets.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#9ca3af' : '#6b7280',
                          }}
                        >
                          No pets listed.
                        </Text>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingRight: 6 }}
                        >
                          <View style={{ flexDirection: 'row' }}>
                            {ownedPets.map((pet, index) =>
                              renderPetBubble(pet, index),
                            )}
                          </View>
                        </ScrollView>
                      )}
                    </View>

                    {/* Wishlist */}
                    <View>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '500',
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          Wishlist
                        </Text>
                      </View>

                      {wishlistPets.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#9ca3af' : '#6b7280',
                          }}
                        >
                          No wishlist pets yet.
                        </Text>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingRight: 6 }}
                        >
                          <View style={{ flexDirection: 'row' }}>
                            {wishlistPets.map((pet, index) =>
                              renderPetBubble(pet, index),
                            )}
                          </View>
                        </ScrollView>
                      )}
                    </View>
                  </>
                )}
              </View>
            )}

            {/* 📝 Reviews section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  Recent Reviews
                </Text>

                {loadingReviews && reviews.length === 0 ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : reviews.length === 0 ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: isDarkMode ? '#9ca3af' : '#6b7280',
                    }}
                  >
                    No reviews yet.
                  </Text>
                ) : (
                  <>
                    {reviews.map((rev) => {
                      const tsMs = getTimestampMs(
                        rev.updatedAt || rev.createdAt,
                      );
                      const timeLabel = tsMs ? formatCreatedAt(tsMs) : null;

                      return (
                        <View
                          key={rev.id}
                          style={{
                            paddingVertical: 4,
                            paddingHorizontal: 4,
                            borderBottomWidth: 1,
                            borderBottomColor: isDarkMode
                              ? '#1f2937'
                              : '#e5e7eb',
                          }}
                        >
                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: 4,
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: '600',
                                  color: isDarkMode ? '#e5e7eb' : '#111827',
                                  marginBottom: 2,
                                }}
                              >
                                {rev.userName || 'Anonymous'}
                              </Text>
                              {!!rev?.review && (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: isDarkMode ? '#d1d5db' : '#4b5563',
                                    lineHeight: 16,
                                  }}
                                >
                                  {rev.review}
                                </Text>
                              )}
                              {rev?.edited && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: isDarkMode ? '#9ca3af' : '#9ca3af',
                                    marginTop: 2,
                                  }}
                                >
                                  Edited
                                </Text>
                              )}
                            </View>

                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {timeLabel && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: isDarkMode ? '#9ca3af' : '#9ca3af',
                                  }}
                                >
                                  {timeLabel}
                                </Text>
                              )}
                              {renderStars(rev?.rating || 0)}
                            </View>
                          </View>
                        </View>
                      );
                    })}

                    {hasMoreReviews && !loadingReviews && (
                      <TouchableOpacity
                        onPress={handleLoadMoreReviews}
                        style={{
                          marginTop: 8,
                          alignSelf: 'center',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          Load more reviews
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingReviews && hasMoreReviews && (
                      <ActivityIndicator
                        size="small"
                        color={config.colors.primary}
                        style={{ marginTop: 6, alignSelf: 'center' }}
                      />
                    )}
                  </>
                )}
              </View>
            )}

            {/* View details button */}
            {!loadDetails && (
              <TouchableOpacity
                style={styles.saveButtonProfile}
                onPress={() => setLoadDetails(true)}
              >
                <Text
                  style={[
                    styles.saveButtonTextProfile,
                    { color: isDarkMode ? 'white' : 'black' },
                  ]}
                >
                  View Detail Profile
                </Text>
              </TouchableOpacity>
            )}

            {/* Roblox Profile Button */}
            {selectedUser?.robloxUsername && (
              <TouchableOpacity 
                style={[styles.saveButton, { 
                  backgroundColor: isDarkMode ? '#4A90E2' : '#007AFF',
                  marginBottom: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                }]} 
                onPress={handleOpenRobloxProfile}
              >
                <Icon 
                  name="game-controller-outline" 
                  size={16} 
                  color="#FFFFFF" 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.saveButtonText, { color: '#FFFFFF' }]}>
                  View Roblox Profile
                </Text>
              </TouchableOpacity>
            )}

            {/* Start chat button */}
            {!fromPvtChat && (
              <TouchableOpacity style={styles.saveButton} onPress={handleStartChat}>
                <Text style={styles.saveButtonText}>
                  {t('chat.start_chat')}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ProfileBottomDrawer;
