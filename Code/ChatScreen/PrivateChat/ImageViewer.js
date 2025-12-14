import React, { useRef, useMemo, useCallback } from 'react';
import {
  FlatList,
  Image,
  View,
  Text,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';

const { width, height } = Dimensions.get('window');

const ImageViewerScreenChat = ({ route }) => {
  // ✅ Safety checks for route params
  const routeParams = route?.params || {};
  const images = Array.isArray(routeParams.images) ? routeParams.images : [];
  const initialIndex = Math.max(0, Math.min(routeParams.initialIndex || 0, images.length - 1));
  
  const listRef = useRef(null);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  // ✅ Memoize backgroundColor
  const backgroundColor = useMemo(() => isDarkMode ? '#000' : '#fff', [isDarkMode]);

  // ✅ Memoize renderItem with validation
  const renderItem = useCallback(
    ({ item, index }) => {
      // ✅ Safety check
      if (!item || typeof item !== 'string') {
        return (
          <View style={[styles.slide, { backgroundColor }]}>
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Invalid image</Text>
            </View>
          </View>
        );
      }

      return (
        <View style={[styles.slide, { backgroundColor }]}>
          <Image 
            source={{ uri: item }} 
            style={styles.image}
            resizeMode="contain"
            onError={(error) => {
              console.error('Image load error:', error);
            }}
          />
        </View>
      );
    },
    [backgroundColor]
  );

  // ✅ Memoize keyExtractor
  const keyExtractor = useCallback(
    (item, index) => {
      if (item && typeof item === 'string') {
        return item;
      }
      return `image-${index}`;
    },
    []
  );

  // ✅ Memoize getItemLayout
  const getItemLayout = useCallback(
    (data, index) => ({
      length: width,
      offset: width * index,
      index,
    }),
    []
  );

  // ✅ Early return if no images
  if (images.length === 0) {
    return (
      <View style={[styles.slide, { backgroundColor }]}>
        <Text style={[styles.errorText, { color: isDarkMode ? '#fff' : '#000' }]}>
          No images to display
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={images}
      horizontal
      pagingEnabled
      initialScrollIndex={initialIndex}
      getItemLayout={getItemLayout}
      initialNumToRender={3}
      maxToRenderPerBatch={3}
      windowSize={5}
      removeClippedSubviews={true}
      showsHorizontalScrollIndicator={false}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
    />
  );
};

const styles = StyleSheet.create({
  slide: {
    width,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width,
    height: '100%',
    resizeMode: 'contain',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#999',
  },
});

export default ImageViewerScreenChat;
