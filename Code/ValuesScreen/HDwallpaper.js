// HDWallpaperScreen.jsx
import React, { useMemo, useState, useCallback, useEffect } from "react";
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
import { ref, onValue, update, increment } from "@react-native-firebase/database";
import { useGlobalState } from "../GlobelStats";
import InterstitialAdManager from "../Ads/IntAd";
import { useLocalState } from "../LocalGlobelStats";
import {CameraRoll} from "@react-native-camera-roll/camera-roll"; // ✅ default import

// Base URL for your wallpapers
const IMAGE_BASE = "https://pull-gag.b-cdn.net/wallpaper";

// how many you want to load per "page"
const PAGE_SIZE = 14;

const HDWallpaperScreen = () => {
  const { appdatabase } = useGlobalState();
  const { localState } = useLocalState();

  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const [totalPics, setTotalPics] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0); // how many are currently shown
  const [loadingIds, setLoadingIds] = useState({});
  const [fullImageLoading, setFullImageLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [likeData, setLikeData] = useState({});
  const [loadMoreClickCount, setLoadMoreClickCount] = useState(0); // Track load more clicks for ad logic

  // 🔢 Listen to Firebase count (pic_numbers)
  useEffect(() => {
    if (!appdatabase) return;

    const picCountRef = ref(appdatabase, "pic_numbers"); // value like 55

    const unsubscribe = onValue(picCountRef, (snapshot) => {
      const total = snapshot.val() || 0;
      setTotalPics(total);

      // initialize or clamp visibleCount
      setVisibleCount((prev) => {
        if (prev === 0) {
          // first time: show up to PAGE_SIZE
          return Math.min(PAGE_SIZE, total);
        }
        // if total decreased and now < visible, clamp
        if (prev > total) return total;
        return prev;
      });
    });

    return () => unsubscribe();
  }, [appdatabase]);

  // 🔁 Sync counters from /like_counter into separate state
  useEffect(() => {
    if (!appdatabase) return;

    const likeCounterRef = ref(appdatabase, "like_counter");
    const unsubscribe = onValue(likeCounterRef, (snapshot) => {
      const data = snapshot.val() || {};
      setLikeData(data);
    });

    return () => unsubscribe();
  }, [appdatabase]);

  // 🧱 Build base items whenever totalPics / visibleCount / likeData changes
  useEffect(() => {
    if (!totalPics || !visibleCount) {
      setItems([]);
      return;
    }

    const countToRender = Math.min(totalPics, visibleCount);

    setItems((prev) => {
      const baseItems = [];

      for (let i = 1; i <= countToRender; i++) {
        const id = String(i);
        const fileName = `pic${i}.png`;
        const remote = likeData[id] || {};

        baseItems.push({
          id,
          fileName,
          url: `${IMAGE_BASE}/${fileName}`,
          likes: remote.likes || 0,
          dislikes: remote.dislikes || 0,
          downloads: remote.downloads || 0,
          likedState: "none", // will be overridden by prev if any
        });
      }

      // ✅ Preserve existing state (likedState AND downloads) to prevent overwriting local increments
      return baseItems.map((base) => {
        const existing = prev.find((p) => p.id === base.id);
        if (existing) {
          // ✅ Keep existing downloads if it's higher (local increment might not be synced yet)
          // ✅ Also preserve likedState
          return {
            ...base,
            likedState: existing.likedState || "none",
            downloads: Math.max(base.downloads, existing.downloads || 0),
          };
        }
        return base;
      });
    });
  }, [totalPics, visibleCount, likeData]);
  const requestAndroidGalleryPermission = async () => {
    if (Platform.OS !== 'android') return true;
  
    try {
      // Android 13+ uses READ_MEDIA_IMAGES
      if (Platform.Version >= 33) {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        );
        return res === PermissionsAndroid.RESULTS.GRANTED;
      }
  
      // Older Android versions use WRITE_EXTERNAL_STORAGE
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      console.log('Permission error:', e);
      return false;
    }
  };
  
  const pushCounters = useCallback(
    (id, partial) => {
      if (!appdatabase) return;
      const nodeRef = ref(appdatabase, `like_counter/${id}`);
      // ✅ Note: downloads are handled separately with increment() for atomic updates
      // This function is used for likes/dislikes updates
      update(nodeRef, partial).catch((e) =>
        console.log("Firebase like_counter update error:", e),
      );
    },
    [appdatabase],
  );

  const toggleReaction = useCallback(
    (id, reaction) => {
      let fbPayload = null;

      // update list items
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;

          let { likes, dislikes, likedState } = item;

          if (reaction === "like") {
            if (likedState === "like") {
              likes = Math.max(0, likes - 1);
              likedState = "none";
            } else {
              likes += 1;
              if (likedState === "dislike")
                dislikes = Math.max(0, dislikes - 1);
              likedState = "like";
            }
          } else if (reaction === "dislike") {
            if (likedState === "dislike") {
              dislikes = Math.max(0, dislikes - 1);
              likedState = "none";
            } else {
              dislikes += 1;
              if (likedState === "like") likes = Math.max(0, likes - 1);
              likedState = "dislike";
            }
          }

          const updated = { ...item, likes, dislikes, likedState };
          fbPayload = { id, likes, dislikes, downloads: item.downloads };
          return updated;
        }),
      );

      // keep modal state in sync
      setSelected((prevSelected) => {
        if (!prevSelected || prevSelected.id !== id) return prevSelected;

        let { likedState } = prevSelected;

        if (reaction === "like") {
          likedState = likedState === "like" ? "none" : "like";
        } else if (reaction === "dislike") {
          likedState = likedState === "dislike" ? "none" : "dislike";
        }

        return { ...prevSelected, likedState };
      });

      if (fbPayload) {
        pushCounters(fbPayload.id, {
          likes: fbPayload.likes,
          dislikes: fbPayload.dislikes,
          downloads: fbPayload.downloads,
        });
      }
    },
    [pushCounters],
  );

  const handleRefresh = useCallback(() => {
    if (!totalPics) return;

    setRefreshing(true);

    // Reset visible count (first page), items will rebuild from likeData
    setVisibleCount(Math.min(PAGE_SIZE, totalPics));

    setLoadingIds({});
    setSelected(null);
    setFullImageLoading(false);
    setLoadMoreClickCount(0); // Reset load more click counter

    setRefreshing(false);
  }, [totalPics]);

  const handleDownload = useCallback(
    async (item) => {
      try {
        setDownloadingId(item.id);
  
        // ✅ Android: ask for permission first
        if (Platform.OS === 'android') {
          const granted = await requestAndroidGalleryPermission();
          if (!granted) {
            Alert.alert(
              'Permission required',
              'Storage permission is needed to save wallpapers to your gallery.',
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
          setItems((prev) =>
            prev.map((w) => {
              if (w.id !== item.id) return w;
              return { ...w, downloads: (w.downloads || 0) + 1 };
            }),
          );

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
  
          Alert.alert('Downloaded', 'Wallpaper saved to your gallery.');
        } else {
          Alert.alert('Error', 'Could not download this image.');
        }
      } catch (e) {
        console.log('Download error (raw):', e);
        Alert.alert(
          'Error',
          e?.message || 'Something went wrong while downloading.',
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [pushCounters],
  );
  

  // 🔽 Load more (next 14)
  const handleLoadMore = useCallback(() => {
    const callbackfunction = () => {
      setVisibleCount((prev) => {
        if (!totalPics) return prev;
        const next = prev + PAGE_SIZE;
        return Math.min(next, totalPics);
      });
    };

    // Increment click count and check if we should show ad
    setLoadMoreClickCount((prev) => {
      const newCount = prev + 1;
      const isEvenClick = newCount % 2 === 0; // 2nd, 4th, 6th, etc.
      
      setTimeout(() => {
        if (!localState.isPro && isEvenClick) {
          // Show ad on even clicks (2nd, 4th, 6th, etc.)
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                InterstitialAdManager.showAd(callbackfunction);
              } catch (err) {
                console.warn("[AdManager] Failed to show ad:", err);
                callbackfunction();
              }
            }, 400);
          });
        } else {
          // No ad on odd clicks (1st, 3rd, 5th, etc.) or if user is pro
          callbackfunction();
        }
      }, 500);
      
      return newCount;
    });
  }, [totalPics, localState.isPro]);

  const renderItem = useCallback(
    ({ item }) => {
      const isLoading = !!loadingIds[item.id];

      return (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => {
            setFullImageLoading(true);
            setSelected(item);
          }}
        >
          <View>
            <Image
              source={{ uri: item.url }}
              style={styles.image}
              resizeMode="cover"
              onLoadStart={() => {
                setLoadingIds((prev) => ({ ...prev, [item.id]: true }));
              }}
              onLoadEnd={() => {
                setLoadingIds((prev) => {
                  const next = { ...prev };
                  delete next[item.id];
                  return next;
                });
              }}
              onError={(e) => {
                console.log("IMAGE ERROR:", item.url, e.nativeEvent.error);
                setLoadingIds((prev) => {
                  const next = { ...prev };
                  delete next[item.id];
                  return next;
                });
              }}
            />

            <View style={styles.cardOverlay}>
              <View style={styles.reactionRow}>
                <TouchableOpacity
                  onPress={() => toggleReaction(item.id, "like")}
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
                  onPress={() => toggleReaction(item.id, "dislike")}
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
                onPress={() => handleDownload(item)}
              >
                {downloadingId === item.id ? (
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
    },
    [downloadingId, handleDownload, toggleReaction, loadingIds],
  );

  const keyExtractor = useCallback((item) => item.id, []);
  const selectedUrl = useMemo(() => selected?.url || "", [selected]);

  const renderFooter = () => {
    if (!totalPics || visibleCount >= totalPics) return null;

    return (
      <View style={styles.footer}>
        <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMore}>
          <Text style={styles.loadMoreText}>Load more</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
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
    fontFamily: "Lato-Regular",
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
    fontFamily: "Lato-Bold",
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
    fontFamily: "Lato-Bold",
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
