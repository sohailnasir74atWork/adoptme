import { StyleSheet } from "react-native";
import config from "../Helper/Environment";
import { getThemeColors } from '../Helper/themeColors';

export const getStyles = (isDarkMode) => {
  const c = getThemeColors(isDarkMode);
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
      padding: 8,
    },
    cardContainer: {
      backgroundColor: c.bgAlt,
      borderRadius: 10,
      // paddingVertical: 1,
      paddingHorizontal: 5,
      marginBottom: 10,
    },
    optionuserName: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 15,
      paddingVertical: 12,
    },
    profileImage: {
      width: 60,
      height: 60,
      borderRadius: 30,
      marginRight: 10,
      backgroundColor: 'white'

    },
    profileImage2: {
      width: 56,
      height: 56,
      borderRadius: 28,
      marginRight: 12,
      backgroundColor: c.bgAlt,
      borderWidth: 2,
      borderColor: c.border,
    },
    userName: {
      fontSize: 18,
      fontwEIGHT: 'bold',
      color: c.text,
      lineHeight: 24

    },
    userNameLogout: {
      fontSize: 18,
      fontwEIGHT: 'bold',
      color: config.colors.secondary,
      lineHeight: 24
    },
    reward: {
      fontSize: 14,
      color: c.textSecondary,

    },
    rewardLogout: {
      fontSize: 12,
      color: c.textSecondary,

      overflow: 'hidden',
      width: 250,
      flexWrap: 'wrap'
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    optionLast: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15,
      paddingVertical: 8,
      borderBottomColor: c.border,
    },
    optionText: {
      fontSize: 14,
      marginLeft: 10,
      color: c.text,

      lineHeight: 24
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    drawer: {
      backgroundColor: c.bg,
      padding: 20,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowOffset: { width: 0, height: -4 },
      shadowRadius: 16,
      elevation: 12,
    },
    drawerTitle: {
      fontSize: 18,
      marginBottom: 15,
      fontwEIGHT: 'bold'

    },

    input: {
      backgroundColor: c.bg,
      padding: 10,
      borderRadius: 5,
      marginBottom: 20,
      color: c.text,
    },
    imageOption: {
      width: 60,
      height: 60,
      borderRadius: 30,
      marginHorizontal: 10,
      borderWidth: 2,
      borderColor: '#007BFF',
    },
    saveButton: {
      backgroundColor: config.colors.primary,
      paddingVertical: 14,
      borderRadius: 16,
      marginTop: 8,
      shadowColor: config.colors.primary,
      shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 6,
      elevation: 3,
    },
    saveButtonText: {
      color: '#fff',
      textAlign: 'center',
      fontWeight: '600',
      fontSize: 14,
    },
    saveButtonProfile: {
      borderWidth: 1.5,
      borderColor: config.colors.primary,
      paddingVertical: 14,
      borderRadius: 16,
      marginTop: 16,
      backgroundColor: isDarkMode ? config.colors.primary + '15' : config.colors.primary + '08',
    },
    saveButtonTextProfile: {
      textAlign: 'center',
      fontWeight: '600',
      fontSize: 14,
    },
    drawerSubtitle: {
      color: c.text,
      fontWeight: 'bold',
      marginBottom: 5
    },
    drawerSubtitleUser: {
      color: c.text,
      fontWeight: '700',
      fontSize: 16,
    },
    subtitle: {
      color: c.text,
      fontwEIGHT: 'bold',
      marginVertical: 10
    },
    rewardDescription: {
      color: c.text,

      fontSize: 12

    },
    optionTextLogout: {
      fontSize: 14,
      lineHeight: 16,
      marginLeft: 10,
      color: config.colors.wantBlockRed,

    },
    optionTextDelete: {
      fontSize: 16,
      marginLeft: 10,
      color: !isDarkMode ? '#5A1F1F' : '#FFE5E5',


    },
    optionDelete: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      borderBottomColor: c.border,
      backgroundColor: isDarkMode ? '#5A1F1F' : '#FFE5E5',


    },
    containertheme: {
      flexDirection: 'row',
      borderWidth: 1,
      borderRadius: 50,
      borderColor: config.colors.hasBlockGreen,
    },
    box: {
      paddingVertical: 7,
      paddingHorizontal: 6,
      // backgroundColor: '#ccc',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',

      borderRadius: 50,



    },
    selectedBox: {
      backgroundColor: config.colors.hasBlockGreen, // Highlight selected box
    },
    // text:{
    //   ,
    //   fontSize:12,
    //   color: isDarkMode ? '#fff' : '#000',

    // },
    selectedText: {
      color: 'white',

      fontSize: 10,
    },
    subscriptionContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderWidth: 1,
      borderColor: config.colors.hasBlockGreen,
      borderRadius: 8,
      marginVertical: 10,
    },
    subscriptionText: {
      color: config.colors.hasBlockGreen,
      fontSize: 16,
      fontWeight: 'bold',
    },
    manageButton: {
      backgroundColor: config.colors.hasBlockGreen,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
    },
    manageButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: 'bold',
    },
    menuTrigger: {
      paddingRight: 10
    },
    options: {
      padding: 5,
      // maxWidth:100,
      borderRadius: 10
    },
    option_menu: {
      padding: 10
    },
    text: {

      fontSize: 12,
      color: c.text,
      paddingHorizontal: 5
    },
    textlink: {

      fontSize: 12,
      color: c.text,
      paddingHorizontal: 5,
    },
    emailText: {
      fontSize: 12,
      color: isDarkMode ? 'lightblue' : 'blue', // Blue color to make it look like a link
      textDecorationLine: 'underline', // Underline to signify it as a link
      lineHeight: 12

    },
    petsSection: {
      marginTop: 12,
      // flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      // flex: 1,

    },

    petsColumn: {
      // flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 10
    },

    petsHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,

    },

    petsTitle: {
      fontSize: 14,
      fontWeight: 'bold',
      color: c.text,
    },

    petsActionText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#4A90E2',
    },

    petsEmptyText: {
      fontSize: 11,
      color: c.textSecondary,
    },

    petsAvatarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: 2,
    },

    petBubble: {
      width: 34,
      height: 34,
      borderRadius: 17,
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: c.border,
    },

    petImageSmall: {
      width: '100%',
      height: '100%',
    },

    moreBubble: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },

    moreBubbleText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
    },
    imageOptionWrapper: {
      marginRight: 8,
      padding: 2,
      borderRadius: 999,
    },
    imageOptionSelected: {
      borderWidth: 2,
      borderColor: '#4CAF50',
    },
    imageOption: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    reviewsSection: {
      marginTop: 12,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    reviewsHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    reviewsTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
    },
    reviewsList: {
      maxHeight: 200,
    },
    reviewItem: {
      backgroundColor: c.bgAlt,
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
    },
    reviewHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    reviewHeaderLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    reviewUserName: {
      fontSize: 14,
      fontWeight: '600',
      color: c.text,
      marginRight: 8,
    },
    reviewRating: {
      flexDirection: 'row',
      marginRight: 8,
    },
    editedBadge: {
      fontSize: 10,
      color: c.textSecondary,
      fontStyle: 'italic',
    },
    editButton: {
      padding: 4,
    },
    reviewText: {
      fontSize: 13,
      color: c.textSecondary,
      marginBottom: 6,
      lineHeight: 18,
    },
    reviewDate: {
      fontSize: 11,
      color: c.textSecondary,
    },
    reviewsEmptyText: {
      fontSize: 11,
      color: c.textSecondary,
      textAlign: 'center',
      marginVertical: 20,
    },
    loadMoreButton: {
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      backgroundColor: config.colors.primary,
      alignItems: 'center',
      marginTop: 10,
      marginBottom: 10,
    },
    loadMoreText: {
      fontSize: 14,
      fontWeight: 'bold',
      color: '#fff',
    },
  });
};
