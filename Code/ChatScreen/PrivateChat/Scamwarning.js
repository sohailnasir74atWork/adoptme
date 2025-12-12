import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';

export default function ScamSafetyBox({
  setShowRatingModal,
  canRate,
  hasRated,
  onOpenSafeServer, // optional handler for server button
}) {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const handleOpenServer = () => {
    if (typeof onOpenSafeServer === 'function') {
      onOpenSafeServer();
    }
  };

  const handleOpenRating = () => {
    if (typeof setShowRatingModal === 'function') {
      setShowRatingModal(true);
    }
  };

  return (
    <View style={styles.box}>
      {/* LEFT: safety tips as a "pill" */}
      <View style={styles.leftColumn}>
        <View style={styles.warningBox}>
          <Text style={styles.title}>⚠️ Trade Safety</Text>
          <Text style={styles.item}>• If it’s “too good”, it’s probably a scam.</Text>
          <Text style={styles.item}>• Never share login or personal info.</Text>
          <Text style={styles.item}>• Only trade on trusted Roblox servers.</Text>
        </View>
      </View>

      {/* RIGHT: actions */}
      {canRate && (
        <View style={styles.rightColumn}>
          {/* Safe server button */}
          <TouchableOpacity
            style={[styles.buttonBase, styles.serverButton]}
            onPress={handleOpenServer}
          >
            <Text style={[styles.buttonTitle, styles.serverButtonTitle]}>
              Join safe server
            </Text>
            <Text style={[styles.buttonSub, styles.serverButtonSub]}>
              Trade using a trusted Roblox link
            </Text>
          </TouchableOpacity>

          {/* Rating button */}
          <TouchableOpacity
            style={[styles.buttonBase, styles.rateButton]}
            onPress={handleOpenRating}
          >
            <Text style={[styles.buttonTitle, styles.rateButtonTitle]}>
              {hasRated ? 'Edit rating' : 'Rate trader'}
            </Text>
            <Text style={[styles.buttonSub, styles.rateButtonSub]}>
              {hasRated
                ? 'Update your review for this trader'
                : 'Help other players stay safe'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 5,
      marginHorizontal: 4,
      marginTop: 3,
      marginBottom: 3,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#1f2933' : '#E2E8F0',
      backgroundColor: 'transparent',
    },
    leftColumn: {
      flex: 1,
      paddingRight: 5,
    },
    // 🔹 Safety warnings styled like a soft "button" / pill
    warningBox: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: isDark ? '#4B5563' : '#FBBF77',
      backgroundColor: isDark ? 'rgba(15,23,42,0.7)' : '#FFF7ED',
    },
    rightColumn: {
      flexShrink: 0,
      justifyContent: 'center',
      alignItems: 'flex-end',
      gap: 6, // if not supported use marginBottom on buttons
    },
    title: {
      fontSize: 11,
      color: isDark ? '#FCD34D' : '#92400E',
      marginBottom: 6,
      fontFamily: 'Lato-Bold',
    },
    item: {
      fontSize: 9,
      color: isDark ? '#E5E7EB' : '#4B5563',
      marginBottom: 5,
      fontFamily:'Lato-Regular'
    },

    // shared button base (same size)
    buttonBase: {
      width: 170,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 8,
      justifyContent: 'center',
    },

    // server (outlined) button
    serverButton: {
      borderWidth: 1,
      borderColor: config.colors.primary,
      backgroundColor: isDark ? 'transparent' : '#ffffff',
    },
    // rating (filled) button
    rateButton: {
      backgroundColor: config.colors.primary,
    },

    buttonTitle: {
      fontSize: 11,
      fontFamily: 'Lato-Bold',
    },
    buttonSub: {
      fontSize: 9,
      marginTop: 2,
    },

    // color overrides
    serverButtonTitle: {
      color: config.colors.primary,
      fontFamily: 'Lato-Bold',
    },
    serverButtonSub: {
      color: isDark ? '#CBD5F5' : '#6B7280',
    },
    rateButtonTitle: {
      color: '#ffffff',
      fontFamily: 'Lato-Regular',
    },
    rateButtonSub: {
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'Lato-Regular',
    },
  });
