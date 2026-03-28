import { StyleSheet } from "react-native";
import config from "../Helper/Environment";
import { getThemeColors } from '../Helper/themeColors';

export const getStyles = (isDarkMode) => {
  const c = getThemeColors(isDarkMode);
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
    },
    loader: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatList: {
      flexGrow: 1,
      justifyContent: 'flex-end',
      // paddingHorizontal: 10,
      paddingVertical: 5,
    },
    mymessageBubble: {
      // width: '100%',
      paddingHorizontal: 10,
      borderRadius: 15,
      flexDirection: "row-reverse",
      marginBottom: 6,
      alignItems: 'flex-end'
    },
    othermessageBubble: {
      // width: '100%',
      // paddingHorizontal: 10,
      borderRadius: 15,
      flexDirection: 'row',
      marginBottom: 6,
      alignItems: 'flex-start',

    },
    myMessage: {
      alignSelf: 'flex-end',
    },
    otherMessage: {
      alignSelf: 'flex-start',

    },
    senderName: {
      marginBottom: 2,
      marginHorizontal: 5,
    },
    senderNameText: {
      fontSize: 12,
      fontWeight: 'bold',
      color: 'grey',
    },
    messageTextBox: {
      // flex: 1,
      maxWidth: '75%',

      // flexDirection:
    },
    messageTextBoxAdmin: {
      flexDirection: 'column',
      flex: 1,

    },
    myMessageText: {
      fontSize: 15,
      color: c.text,
      backgroundColor: isDarkMode ? '#0B5E3F' : '#DCF8C6',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 16,
      borderTopRightRadius: 4,
      lineHeight: 20,
    },
    otherMessageText: {
      fontSize: 15,
      color: c.text,
      backgroundColor: c.bgAlt,
      paddingHorizontal: 10,
      borderRadius: 16,
      borderTopLeftRadius: 4,
      paddingVertical: 6,
      lineHeight: 20,
    },
    myMessageTextOnly: {
      fontSize: 15,
      color: c.text,

      lineHeight: 20,
      textAlign: 'left',
    },
    otherMessageTextOnly: {
      fontSize: 15,
      color: c.text,

      lineHeight: 20,
      textAlign: 'left',
    },
    timestamp: {
      fontSize: 10,
      color: c.textMuted,
      textAlign: 'right',
      paddingHorizontal: 5
    },
    input: {
      flex: 1,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginRight: 6,
      fontSize: 15,
      minHeight: 36,
      maxHeight: 100,
      textAlignVertical: 'top',
      backgroundColor: c.bgAlt,
    },

    // sendButton: {
    //   borderRadius: 20,
    //   // paddingVertical: 10,
    //   paddingHorizontal: 20,
    //   // backgroundColor:config.colors.primary
    // },
    // sendButtonText: {
    //   color: '#fff',
    //   fontSize: 16,
    //   fontWeight: 'bold' ,
    // },
    loggedOutMessage: {
      flex: 1,
      fontSize: 16,
      paddingVertical: 10,
    },
    loggedOutMessageText: {
      color: '#bbb',
      textAlign: 'center',
    },
    dateSeparator: {
      fontSize: 14,
      color: '#888',
      textAlign: 'center',
      marginVertical: 10,
    },

    platformText: {
      color: 'white',
      fontSize: 6,
      fontWeight: 'bold',
    },

    admin: {
      // alignSelf: 'flex-start',
      color: 'white',
      // fontSize: 10,
      fontWeight: 'bold',
      // color: config.colors.primary,
      fontSize: 9,
    },
    verifiedContainer: {
      backgroundColor: '#4CAF50',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 3,
      marginLeft: 4,
    },
    verified: {
      color: 'white',
      fontSize: 9,
      fontWeight: 'bold',
      // lineHeight:10,


    },
    adminText: {
      fontSize: 10,
      color: 'white',
      paddingTop: 5
    },
    login: {
      height: 40,
      justifyContent: 'center',
      color: config.colors.hasBlockGreen,
      alignSelf: 'center',
      width: '100%',
      borderTopWidth: 1,
      borderColor: c.border,

      //  borderRadius:10

    },
    loginText: {
      color: config.colors.hasBlockGreen,
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: 24

    },
    inputWrapper: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderTopWidth: 0.5,
      borderTopColor: c.border,
      backgroundColor: c.bgAlt,
    },
    cancelReplyButton: {
      alignSelf: 'flex-end',

    },
    cancelReplyText: {
      color: '#E74C3C',
      fontSize: 12,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // input: {
    //   flex: 1,
    //   backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
    //   borderRadius: 20,
    //   paddingHorizontal: 15,
    //   paddingVertical: 10,
    //   fontSize: 16,
    // },
    sendButton: {
      marginLeft: 4,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    sendButtonText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    replyContainer: {
      backgroundColor: c.bgAlt,
      borderLeftWidth: 2,
      borderLeftColor: isDarkMode ? '#1E88E5' : '#007BFF',
      paddingHorizontal: 6,
      paddingVertical: 3,
      marginBottom: 3,
      borderRadius: 4,
    },
    replyText: {
      fontSize: 12,
      color: isDarkMode ? '#1E88E5' : '#007BFF',
      width: '95%'
    },
    replySenderText: {
      fontSize: 12,
      fontWeight: 'bold',
      color: c.text,
    },
    profileImage: {
      height: 34,
      width: 34,
      borderRadius: 17,
      backgroundColor: 'white'
    },
    profileImagePvtChat: {
      height: 30,
      width: 30,
      borderRadius: 15,
      marginHorizontal: 5,
      backgroundColor: 'white'
    },

    userName: {
      color: c.textMuted,
      fontSize: 10,
      justifyContent: 'center',
      // backgroundColor:'red',
      backgroundColor: 'red',
      lineHeight: 14,
      fontwEIGHT: 'bold'

    },
    adminActions: {
      // flexDirection: 'row',
      justifyContent: 'center',
      // alignItems:'flex-end',
      // overflow:'hidden',
      // flexWrap:"wrap"
    },
    adminTextAction: {
      backgroundColor: config.colors.wantBlockRed,
      marginHorizontal: 3,
      padding: 10,
      borderRadius: 3,
      color: 'white',
      alignSelf: 'center',
      minWidth: 150,
      // fontSize:10
    },
    dot: {
      color: '#bbb',
      marginHorizontal: 5,
      fontSize: 14
    },
    linkText: {
      color: '#1E90FF', // Blue color for links
      textDecorationLine: 'underline', // Underline to indicate a link
    },

    menu: {
      borderRadius: 20,
      // backgroundColor:'red'
    },
    menuTrig: {
      borderRadius: 50,
      // backgroundColor: 'red',
      marginBottom: 100

    },
    menuoptions: {
      maxWidth: 140,
      borderRadius: 8,
      marginLeft: 50,
    },
    menuOption: {
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderBottomWidth: 0.5,
      borderColor: 'lightgrey',
      backgroundColor: 'white',
      borderRadius: 8,
    },
    menuOptionText: {
      fontSize: 13,
      color: '#000',
    },
    reportIcon: {
      position: 'absolute',
      right: 2,
      top: 2,
      opacity: 1,
      color: config.colors.wantBlockRed,
      fontSize: 8,
      fontStyle: 'italic'

    },
    reportedMessage: {
      opacity: .3, // Light blue color
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      // backgroundColor:'red'

    },
    emptyText: {
      color: c.text,
    },
    tradeDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: 'grey',
      paddingHorizontal: 10


    },
    itemList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-evenly',
      width: "45%",
      paddingVertical: 0,
      // backgroundColor:'red'
    },
    itemImage: {
      width: 30,
      height: 30,
      // marginRight: 5,
      // borderRadius: 25,
      marginVertical: 5,
      borderRadius: 5
      // padding:10

    },

    transferImage: {
      width: 15,
      height: 15,
      // marginRight: 5,
      borderRadius: 5,
    },
    tradeTotals: {
      flexDirection: 'row',
      justifyContent: 'center',
      // marginTop: 10,
      width: '100%'

    },
    names: {
      fontSize: 8,
      color: 'white'
    },
    priceText: {
      fontSize: 10,

      color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      color: 'white', // ✅ Removed redundant conditional
      marginHorizontal: 'auto',
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 6
    },
    priceTextProfit: {
      fontSize: 10,
      lineHeight: 14,

      // color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      // color: isDarkMode ? 'white' : "grey",
      // marginHorizontal: 'auto',
      // paddingHorizontal: 4,
      // paddingVertical: 2,
      // borderRadius: 6
    },
    tagcount: {
      position: 'absolute',
      backgroundColor: 'purple',
      top: 4,
      left: 1,
      borderRadius: 50,
      paddingHorizontal: 3,
      paddingBottom: 2

    },
    tagcounttext: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 10
    },

    hasBackground: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantBackground: {
      backgroundColor: config.colors.wantBlockRed,
    },
    tradeActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    transfer: {
      width: '10%',
      justifyContent: 'center',
      alignItems: 'center'
    },
    deleteButton: {
      paddingVertical: 5
    },
    chatImage: {
      width: 200,
      height: 200,
      borderRadius: 8,
      marginBottom: 4,
    },
    saveButtonTextProfile: {
      color: c.text,
    },
    highlightedMessage: {
      backgroundColor: '#fef3c7',      // soft yellow
      borderColor: '#f59e0b',
      borderWidth: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },

    userNameText: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
    },
    userNameAdmin: {
      color: c.textMuted,
      fontSize: 11,
      lineHeight: 14,
    },

    icon: {
      width: 10,
      height: 10,
    },

    roleBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 5,
      gap: 2,
    },
    roleBadgeText: {
      color: '#fff',
      fontSize: 7,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },

    platformBadge: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollToBottomButton: {
      position: 'absolute',
      bottom: 105,
      right: 8,
      marginTop: -24, // Half of icon size (48/2) to center it perfectly
      zIndex: 1000,
      elevation: 8, // For Android shadow
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    scrollToBottomTouchable: {
      borderRadius: 24,
      // padding: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },

  });
};