// HDWallpaperScreen.jsx
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  PermissionsAndroid,
} from "react-native";

import Icon from "react-native-vector-icons/Ionicons";
import RNFS from "react-native-fs";
import { ref, get, update, increment } from "@react-native-firebase/database";
import { useGlobalState } from "../GlobelStats";
import InterstitialAdManager from "../Ads/IntAd";
import { useLocalState } from "../LocalGlobelStats";
import { CameraRoll } from "@react-native-camera-roll/camera-roll"; // ✅ default import
import { useTranslation } from "react-i18next";

// Base URL for your wallpapers
const IMAGE_BASE = "https://pull-gag.b-cdn.net/wallpaper";

// how many you want to load per "page"
const PAGE_SIZE = 14;

// The user's own like/dislike per wallpaper ('like' | 'dislike'; no key =
// none), so a reaction survives leaving the screen. Before, nothing was kept
// and every visit could like the same wallpaper again.
let reactionStore;
try {
  const { createMMKV } = require("react-native-mmkv");
  reactionStore = createMMKV({ id: "wallpaper_reactions" });
} catch (e) {
  const mem = new Map();
  reactionStore = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}
const readReaction = (id) => reactionStore.getString(id) || "none";

// One grid cell. Memoized, and it owns its image-loading flag: while that flag
// lived in the screen, every image starting or finishing re-rendered every
// card (~28 renders per card per page).
const WallpaperCard = React.memo(function WallpaperCard({
  item,
  isDownloading,
  onOpen,
  onToggle,
  onDownload,
}) {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => onOpen(item)}
    >
      <View>
        {/* resizeMethod="resize": decode at cell size. The files are 1080×1920
            PNGs (~8 MB each as a full bitmap); the preview still loads full size. */}
        <Image
          source={{ uri: item.url }}
          style={styles.image}
          resizeMode="cover"
          resizeMethod="resize"
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onError={(e) => {
            console.log("IMAGE ERROR:", item.url, e.nativeEvent.error);
            setIsLoading(false);
          }}
        />

        <View style={styles.cardOverlay}>
          <View style={styles.reactionRow}>
            <TouchableOpacity
              onPress={() => onToggle(item.id, "like")}
              style={styles.iconButton}
            >
              <Icon
                name={
                  item.likedState === "like" ? "heart" : "heart-outline"
                }
                size={18}
                color={
                  item.likedState === "like" ? "#ff6b81" : "#ffffff"
                }
              />
              <Text style={styles.counterText}>{item.likes}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onToggle(item.id, "dislike")}
              style={styles.iconButton}
            >
              <Icon
                name={
                  item.likedState === "dislike"
                    ? "thumbs-down"
                    : "thumbs-down-outline"
                }
                size={18}
                color={
                  item.likedState === "dislike"
                    ? "#ffd166"
                    : "#ffffff"
                }
              />
              <Text style={styles.counterText}>{item.dislikes}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.downloadButton}
            onPress={() => onDownload(item)}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#0d1f17" />
            ) : (
              <View
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Icon
                  name="download-outline"
                  size={18}
                  color="#0d1f17"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.downloadText}>
                  {item.downloads}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {isLoading && (
          <View style={styles.imageLoaderOverlay}>
            <ActivityIndicator size="small" color="#ffffff" />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

const HDWallpaperScreen = () => {
  const { t } = useTranslation();
  const { appdatabase } = useGlobalState();
  const { localState } = useLocalState();

  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const [totalPics, setTotalPics] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0); // how many are currently shown
  const [fullImageLoading, setFullImageLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [likeData, setLikeData] = useState({});
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreCountRef = useRef(0); // Track load more clicks for ad logic
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 🔢 Fetch pic_numbers once on mount — it's a counter that only changes
  // when an admin adds wallpapers (very rare). The previous onValue
  // listener cost a persistent RTDB subscription per active client.
  useEffect(() => {
    if (!appdatabase) return;
    get(ref(appdatabase, "pic_numbers")).then((snap) => {
      const total = snap.val() || 0;
      setTotalPics(total);
      setVisibleCount((prev) => {
        if (prev === 0) return Math.min(PAGE_SIZE, total);
        if (prev > total) return total;
        return prev;
      });
    }).catch(() => { /* leave totalPics at 0 */ });
  }, [appdatabase]);

  // 📥 Fetch /like_counter once on mount instead of subscribing.
  // The old onValue listener re-downloaded the entire like_counter object
  // every time ANYONE liked anything anywhere — bandwidth scaled with both
  // wallpaper count and total user activity. User's own likes update
  // locally via toggleReaction (no listener needed for that). Cost:
  // other users' likes don't update live while you're on this screen.
  useEffect(() => {
    if (!appdatabase) return;
    get(ref(appdatabase, "like_counter"))
      .then((snap) => setLikeData(snap.val() || {}))
      .catch(() => { /* keep empty likeData */ });
  }, [appdatabase]);

  // 🧱 Build items whenever totalPics / visibleCount / likeData changes.
  // likeData already holds this user's own taps and downloads (bumpLocal),
  // and the user's reaction comes from reactionStore.
  useEffect(() => {
    if (!totalPics || !visibleCount) {
      setItems([]);
      return;
    }

    const countToRender = Math.min(totalPics, visibleCount);

    setItems((prev) => {
      const next = [];

      for (let i = 1; i <= countToRender; i++) {
        const id = String(i);
        const fileName = `pic${i}.png`;
        const remote = likeData[id] || {};

        const base = {
          id,
          fileName,
          url: `${IMAGE_BASE}/${fileName}`,
          likes: remote.likes || 0,
          dislikes: remote.dislikes || 0,
          downloads: remote.downloads || 0,
          likedState: readReaction(id),
        };

        // ✅ Unchanged → keep the old object so its memoized card skips the render
        const existing = prev[i - 1];
        const same = existing && existing.id === id &&
          existing.likes === base.likes && existing.dislikes === base.dislikes &&
          existing.downloads === base.downloads && existing.likedState === base.likedState;
        next.push(same ? existing : base);
      }

      return next;
    });
  }, [totalPics, visibleCount, likeData]);
  const requestAndroidGalleryPermission = async () => {
    if (Platform.OS !== 'android') return true;

    try {
      // Android 10+ saves new images through MediaStore without storage
      // permission. READ_MEDIA_IMAGES only grants access to existing photos and
      // must not be used as a prerequisite for adding a wallpaper.
      if (Platform.Version >= 29) return true;

      // Android 9 and older still require legacy external-storage write access.
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      console.log('Permission error:', e);
      return false;
    }
  };

  // Apply this user's own change to the local copy of /like_counter.
  const bumpLocal = useCallback((id, delta) => {
    setLikeData((prev) => {
      const cur = prev[id] || {};
      const next = { ...cur };
      Object.keys(delta).forEach((k) => {
        next[k] = Math.max(0, (cur[k] || 0) + delta[k]);
      });
      return { ...prev, [id]: next };
    });
  }, []);

  // Deltas via increment(), never absolute counts: writing counts from this
  // screen's snapshot erased every like other users made since it opened.
  // One update per field, because the rule rejects a count below 0 and a
  // rejected multi-field update would drop the other field's change too.
  const pushCounters = useCallback(
    (id, delta) => {
      if (!appdatabase) return;
      const nodeRef = ref(appdatabase, `like_counter/${id}`);
      Object.keys(delta).forEach((field) => {
        if (!delta[field]) return;
        update(nodeRef, { [field]: increment(delta[field]) }).catch((e) =>
          console.log("Firebase like_counter update error:", e),
        );
      });
    },
    [appdatabase],
  );

  const toggleReaction = useCallback(
    (id, reaction) => {
      // The stored reaction is read and written synchronously, so fast
      // repeat taps can't count twice.
      const prevState = readReaction(id);
      const nextState = prevState === reaction ? "none" : reaction;

      const delta = { likes: 0, dislikes: 0 };
      if (prevState === "like") delta.likes -= 1;
      if (prevState === "dislike") delta.dislikes -= 1;
      if (nextState === "like") delta.likes += 1;
      if (nextState === "dislike") delta.dislikes += 1;

      if (nextState === "none") reactionStore.remove(id);
      else reactionStore.set(id, nextState);

      bumpLocal(id, delta);

      // keep modal state in sync
      setSelected((prevSelected) => {
        if (!prevSelected || prevSelected.id !== id) return prevSelected;
        return { ...prevSelected, likedState: nextState };
      });

      pushCounters(id, delta);
    },
    [bumpLocal, pushCounters],
  );

  const handleRefresh = useCallback(async () => {
    if (!appdatabase) return;

    setRefreshing(true);
    try {
      // Re-pull both counters. Mount-time listeners were dropped to save
      // RTDB bandwidth (see the two effects above), so pull-to-refresh is
      // now the user's only way to see admin-added wallpapers and other
      // users' like counts.
      const [picSnap, likeSnap] = await Promise.all([
        get(ref(appdatabase, "pic_numbers")).catch(() => null),
        get(ref(appdatabase, "like_counter")).catch(() => null),
      ]);

      const total = picSnap?.val() || 0;
      setTotalPics(total);
      setVisibleCount(Math.min(PAGE_SIZE, total));
      setLikeData(likeSnap?.val() || {});

      setSelected(null);
      setFullImageLoading(false);
      loadMoreCountRef.current = 0;
    } finally {
      setRefreshing(false);
    }
  }, [appdatabase]);

  const handleDownload = useCallback(
    async (item) => {
      try {
        setDownloadingId(item.id);

        // ✅ Android: ask for permission first
        if (Platform.OS === 'android') {
          const granted = await requestAndroidGalleryPermission();
          if (!granted) {
            Alert.alert(
              t('wallpaper.permission_title'),
              t('wallpaper.permission_message'),
            );
            return;
          }
        }

        const fileName = item.fileName || `wallpaper-${item.id}.jpg`;
        const destPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

        const res = await RNFS.downloadFile({
          fromUrl: item.url,
          toFile: destPath,
          connectionTimeout: 15000,
          readTimeout: 30000,
        }).promise;

        if (res.statusCode === 200) {
          // ✅ CameraRoll prefers a URI on Android
          const localPath =
            Platform.OS === 'android' ? `file://${destPath}` : destPath;

          await CameraRoll.save(localPath, { type: 'photo' });

          // ✅ Update local state first for immediate UI feedback
          bumpLocal(item.id, { downloads: 1 });

          // ✅ Update selected item in modal if it's the same
          setSelected((prevSelected) => {
            if (!prevSelected || prevSelected.id !== item.id) return prevSelected;
            return { ...prevSelected, downloads: (prevSelected.downloads || 0) + 1 };
          });

          // ✅ Use increment for atomic Firebase update
          if (appdatabase) {
            const nodeRef = ref(appdatabase, `like_counter/${item.id}`);
            update(nodeRef, { downloads: increment(1) }).catch((e) =>
              console.log("Firebase download increment error:", e),
            );
          }

          Alert.alert(t('wallpaper.downloaded_title'), t('wallpaper.downloaded_message'));
        } else {
          Alert.alert(t('alert.error'), t('wallpaper.download_failed'));
        }
      } catch (e) {
        console.log('Download error (raw):', e);
        Alert.alert(
          t('alert.error'),
          t('wallpaper.download_error'),
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [appdatabase, t, bumpLocal],
  );

  const openPreview = useCallback((item) => {
    setFullImageLoading(true);
    setSelected(item);
  }, []);

  // 🔽 Load more (next 14). Non-Pro users see an interstitial on every other
  // tap (2nd, 4th, …). Counted in a ref (no side effects in a state updater),
  // one load at a time, and no state updates once the screen is gone.
  const handleLoadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    const showNextPage = () => {
      // A short cooldown: a quick double tap loads one page, not two plus an ad.
      setTimeout(() => { loadingMoreRef.current = false; }, 400);
      if (!mountedRef.current) return;
      setLoadingMore(false);
      setVisibleCount((prev) => {
        if (!totalPics) return prev;
        const next = prev + PAGE_SIZE;
        return Math.min(next, totalPics);
      });
    };

    loadMoreCountRef.current += 1;
    const isEvenClick = loadMoreCountRef.current % 2 === 0;

    if (!localState.isPro && isEvenClick) {
      try {
        InterstitialAdManager.showAd(showNextPage);
      } catch (err) {
        console.warn("[AdManager] Failed to show ad:", err);
        showNextPage();
      }
    } else {
      showNextPage();
    }
  }, [totalPics, localState.isPro]);

  const renderItem = useCallback(
    ({ item }) => (
      <WallpaperCard
        item={item}
        isDownloading={downloadingId === item.id}
        onOpen={openPreview}
        onToggle={toggleReaction}
        onDownload={handleDownload}
      />
    ),
    [downloadingId, openPreview, toggleReaction, handleDownload],
  );

  const keyExtractor = useCallback((item) => item.id, []);
  const selectedUrl = useMemo(() => selected?.url || "", [selected]);

  const renderFooter = () => {
    if (!totalPics || visibleCount >= totalPics) return null;

    return (
      <View style={styles.footer}>
        {loadingMore ? (
          <ActivityIndicator size="small" color="#f9f871" />
        ) : (
          <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMore}>
            <Text style={styles.loadMoreText}>{t('wallpaper.load_more')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        removeClippedSubviews={false}
        data={items}
        numColumns={2}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={renderFooter}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      {/* Modal code unchanged */}
      <Modal
        visible={!!selected}
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalTopBar}>
            <TouchableOpacity
              onPress={() => setSelected(null)}
              style={styles.closeBtn}
            >
              <Icon name="close" size={22} color="#fff" />
            </TouchableOpacity>

            {selected && (
              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  onPress={() => toggleReaction(selected.id, "like")}
                  style={styles.modalIconBtn}
                >
                  <Icon
                    name={
                      selected.likedState === "like"
                        ? "heart"
                        : "heart-outline"
                    }
                    size={22}
                    color={
                      selected.likedState === "like"
                        ? "#ff6b81"
                        : "#ffffff"
                    }
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => toggleReaction(selected.id, "dislike")}
                  style={styles.modalIconBtn}
                >
                  <Icon
                    name={
                      selected.likedState === "dislike"
                        ? "thumbs-down"
                        : "thumbs-down-outline"
                    }
                    size={22}
                    color={
                      selected.likedState === "dislike"
                        ? "#ffd166"
                        : "#ffffff"
                    }
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalIconBtn}
                  onPress={() => handleDownload(selected)}
                >
                  {downloadingId === selected.id ? (
                    <ActivityIndicator size="small" color="lightgrey" />
                  ) : (
                    <Icon
                      name="download-outline"
                      size={22}
                      color="#ffffff"
                    />
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.zoomWrapper}
            maximumZoomScale={3}
            minimumZoomScale={1}
            centerContent
          >
            {selectedUrl ? (
              <View style={styles.fullImageWrapper}>
                <Image
                  source={{ uri: selectedUrl }}
                  style={styles.fullImage}
                  resizeMode="contain"
                  onLoadStart={() => setFullImageLoading(true)}
                  onLoadEnd={() => setFullImageLoading(false)}
                  onError={(e) => {
                    console.log(
                      "FULL IMAGE ERROR:",
                      selectedUrl,
                      e.nativeEvent.error,
                    );
                    setFullImageLoading(false);
                  }}
                />

                {fullImageLoading && (
                  <View style={styles.fullImageLoaderOverlay}>
                    <ActivityIndicator size="large" color="lightgrey" />
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%" },
  listContent: { paddingBottom: 16 },
  card: {
    flex: 1,
    margin: 3,
    width: "49%",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#0d1f17",
  },
  image: { width: "100%", aspectRatio: 9 / 16 },
  cardOverlay: {
    position: "absolute",
    bottom: 4,
    left: 4,
    right: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reactionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  iconButton: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 4,
  },
  counterText: {
    color: "#ffffff",
    fontSize: 11,
    marginLeft: 3,

  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9f871",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  downloadText: {
    color: "#0d1f17",
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
  modalTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 40,
    paddingBottom: 8,
  },
  closeBtn: { padding: 6 },
  modalActionsRow: { flexDirection: "row", alignItems: "center" },
  modalIconBtn: { padding: 6, marginLeft: 4 },
  zoomWrapper: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  fullImage: { width: "100%", height: "100%" },
  footer: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f9f871",
  },
  loadMoreText: {
    color: "#0d1f17",
    fontSize: 14,
    fontWeight: 'bold',
  },
  imageLoaderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  fullImageLoaderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  fullImageWrapper: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
});

export default HDWallpaperScreen;
