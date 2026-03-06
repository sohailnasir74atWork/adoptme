import { StyleSheet } from "react-native";
import config from "../Helper/Environment";

export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      padding: 8,
    },
    cardContainer: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
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
      // borderBottomWidth:1,
      // borderBottomColor:'grey',
      paddingVertical: 5,
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
      backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0',
      borderWidth: 2,
      borderColor: isDarkMode ? '#334155' : '#e2e8f0',
    },
    userName: {
      fontSize: 18,
      fontwEIGHT: 'bold',
      color: isDarkMode ? '#fff' : '#000',
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
      color: isDarkMode ? '#ccc' : '#666',

    },
    rewardLogout: {
      fontSize: 12,
      color: isDarkMode ? '#ccc' : '#666',

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
      borderBottomColor: isDarkMode ? '#333333' : '#cccccc',
    },
    optionLast: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15,
      paddingVertical: 8,
      borderBottomColor: isDarkMode ? '#333333' : '#cccccc',
    },
    optionText: {
      fontSize: 14,
      marginLeft: 10,
      color: isDarkMode ? '#fff' : '#000',

      lineHeight: 24
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    drawer: {
      backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
      padding: 20,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
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
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      padding: 10,
      borderRadius: 5,
      marginBottom: 20,
      color: isDarkMode ? '#fff' : '#000',
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
      color: isDarkMode ? '#fff' : '#000',
      fontWeight: 'bold',
      marginBottom: 5
    },
    drawerSubtitleUser: {
      color: isDarkMode ? '#f1f5f9' : '#0f172a',
      fontWeight: '700',
      fontSize: 16,
    },
    subtitle: {
      color: isDarkMode ? '#fff' : '#000',
      fontwEIGHT: 'bold',
      marginVertical: 10
    },
    rewardDescription: {
      color: isDarkMode ? '#fff' : '#000',

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
      borderBottomColor: isDarkMode ? '#333333' : '#cccccc',
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
      color: isDarkMode ? '#fff' : '#000',
      paddingHorizontal: 5
    },
    textlink: {

      fontSize: 12,
      color: isDarkMode ? '#fff' : '#000',
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
      color: isDarkMode ? '#e5e7eb' : '#111827',
    },

    petsActionText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#4A90E2',
    },

    petsEmptyText: {
      fontSize: 11,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
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
      borderColor: isDarkMode ? '#334155' : '#e2e8f0',
    },

    petImageSmall: {
      width: '100%',
      height: '100%',
    },

    moreBubble: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
      justifyContent: 'center',
      alignItems: 'center',
    },

    moreBubbleText: {
      fontSize: 11,
      fontWeight: '700',
      color: isDarkMode ? '#F9FAFB' : '#111827',
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
      color: isDarkMode ? '#F9FAFB' : '#111827',
    },
    reviewsList: {
      maxHeight: 200,
    },
    reviewItem: {
      backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
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
      color: isDarkMode ? '#fff' : '#000',
      marginRight: 8,
    },
    reviewRating: {
      flexDirection: 'row',
      marginRight: 8,
    },
    editedBadge: {
      fontSize: 10,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      fontStyle: 'italic',
    },
    editButton: {
      padding: 4,
    },
    reviewText: {
      fontSize: 13,
      color: isDarkMode ? '#E5E7EB' : '#374151',
      marginBottom: 6,
      lineHeight: 18,
    },
    reviewDate: {
      fontSize: 11,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    reviewsEmptyText: {
      fontSize: 11,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
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
