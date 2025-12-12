import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Image, Platform, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { showErrorMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';

const getTradeStatus = (hasTotal, wantsTotal) => {
    if (hasTotal > 0 && wantsTotal === 0) return 'lose';
    if (hasTotal === 0 && wantsTotal > 0) return 'win';
    return 'fair';
};

const ShareTradeModal = ({ visible, onClose, hasItems, wantsItems, hasTotal, wantsTotal, description }) => {
    const viewRef = useRef();
    const { theme } = useGlobalState();
    const { localState } = useLocalState();
    const isDarkMode = theme === 'dark';

    const [showSummary, setShowSummary] = useState(true);
    const [showProfitLoss, setShowProfitLoss] = useState(true);
    const [showLeftGrid, setShowLeftGrid] = useState(true);
    const [showRightGrid, setShowRightGrid] = useState(true);
    const [showBadges, setShowBadges] = useState(true);
    // const [showNotes, setShowNotes] = useState(true);

    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
    const tradeStatus = useMemo(() => getTradeStatus(hasTotal, wantsTotal), [hasTotal, wantsTotal]);
    const profitLoss = wantsTotal - hasTotal;
    const isProfit = profitLoss >= 0;
    const getImageUrl = (item, isGG, baseImgUrl, baseImgUrlGG) => {

        if (!item || !item.name) return '';
    
        if (isGG) {
          const encoded = encodeURIComponent(item.name);
        //   console.log(`${baseImgUrlGG.replace(/"/g, '')}/items/${encoded}.webp`)
          return `${baseImgUrlGG.replace(/"/g, '')}/items/${encoded}.webp`;
        }
    
        if (!item.image || !baseImgUrl) return '';
        return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
      };
    
    
    const progressBarStyle = useMemo(() => {
        if (!hasTotal && !wantsTotal) return { left: '50%', right: '50%' };
        const total = hasTotal + wantsTotal;
        const hasPercentage = (hasTotal / total) * 100;
        const wantsPercentage = (wantsTotal / total) * 100;
        return {
            left: `${hasPercentage}%`,
            right: `${wantsPercentage}%`
        };
    }, [hasTotal, wantsTotal]);

    useEffect(() => {
        if ((!showLeftGrid && showRightGrid) || (showLeftGrid && !showRightGrid)) {
            setShowSummary(false);
        }
    }, [showLeftGrid, showRightGrid]);

    const handleShare = async () => {
        try {
            if (!viewRef.current) return;
            mixpanel.track("Trade Share");
            const uri = await viewRef.current.capture();
            const callbackfunction = async ()=>{
                await Share.open({
                    url: uri,
                    type: 'image/png',
                    failOnCancel: false,
                });
            }
           if(Platform.OS !== 'ios'){ setTimeout(() => {
                if (!localState.isPro) {
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      try {
                        InterstitialAdManager.showAd(callbackfunction);
                      } catch (err) {
                        console.warn('[AdManager] Failed to show ad:', err);
                        callbackfunction();
                      }
                    }, 100); 
                  });
                } else {
                  callbackfunction();
                }
              }, 10); }
          
            if(Platform.OS === 'ios'){
                 await Share.open({
                    url: uri,
                    type: 'image/png',
                    failOnCancel: false,
                });
            }
            onClose();
         
        } catch (error) {
            console.error('Error sharing trade screenshot:', error);
            showErrorMessage('Error', 'Could not share the trade screenshot.');
        }
    };

    const renderToggleButton = (icon, label, state, setState, disabled = false) => (
        <TouchableOpacity
            style={[
                styles.toggleButton,
                state && styles.toggleButtonActive,
                disabled && styles.toggleButtonDisabled
            ]}
            onPress={() => !disabled && setState(!state)}
            disabled={disabled}
        >
            <Icon name={icon} size={16} color={state ? '#fff' : '#666'} />
            <Text style={[styles.toggleButtonText, state && styles.toggleButtonTextActive]}>
                {label}
            </Text>
        </TouchableOpacity>
    );

    const renderBadge = useCallback((type, text) => {
        if (!showBadges) return null;
        
        let backgroundColor;
        switch (type) {
            case 'fly':
                backgroundColor = '#3498db';
                break;
            case 'ride':
                backgroundColor = '#e74c3c';
                break;
            case 'mega':
                backgroundColor = '#9b59b6';
                break;
            case 'neon':
                backgroundColor = '#2ecc71';
                break;
            default:
                backgroundColor = '#FF6666';
        }
        
        return (
            <View style={[styles.badge, { backgroundColor }]}>
                <Text style={styles.badgeText}>{text}</Text>
            </View>
        );
    }, [showBadges]);

    const renderGridItem = useCallback((item, index, totalItems) => {
        if (!item) {
            const isLastFilledIndex = index === totalItems.filter(Boolean).length;
            return (
                <View style={styles.gridItem}>
                    {isLastFilledIndex && (
                        <Icon 
                            name="add-circle" 
                            size={30} 
                            color={isDarkMode ? "#fdf7e5" : '#fdf7e5'} 
                        />
                    )}
                </View>
            );
        }
        
        return (
            <View style={styles.gridItem}>
                <Image
                    source={{ uri: getImageUrl(item, localState.isGG, localState.imgurl, localState.imgurlGG) }}

                    style={styles.gridItemImage}
                />
                <View style={styles.itemBadgesContainer}>
                    {item.isFly && renderBadge('fly', 'F')}
                    {item.isRide && renderBadge('ride', 'R')}
                    {item.valueType && item.valueType !== 'd' && renderBadge(
                        item.valueType === 'm' ? 'mega' : 'neon',
                        item.valueType.toUpperCase()
                    )}
                </View>
            </View>
        );
    }, [isDarkMode, localState, showBadges, renderBadge]);

    const ensureGridItems = useCallback((items) => {
        const result = [...(items || [])];
        while (result.length < 9) {
            result.push(null);
        }
        return result;
    }, []);

    const renderGrid = useCallback((items, isLeft) => {
        if (!(isLeft ? showLeftGrid : showRightGrid)) return null;
        return (
            <View style={styles.itemsContainer}>
                <View style={styles.gridContainer}>
                    {ensureGridItems(items).map((item, index) => (
                        <View key={index} style={[
                            styles.gridItemWrapper,
                            (index + 1) % 3 === 0 && { borderRightWidth: 0 },
                            index >= 6 && { borderBottomWidth: 0 }
                        ]}>
                            {renderGridItem(item, index, items)}
                        </View>
                    ))}
                </View>
            </View>
        );
    }, [showLeftGrid, showRightGrid, ensureGridItems, renderGridItem]);

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            onRequestClose={onClose}
        >
            {/* <ScrollView> */}
            <View style={styles.modalContainer}>
                <View style={styles.modalContent}>
                    <View style={styles.header}>
                        {/* <Text style={styles.title}>Share Trade</Text> */}
                        <TouchableOpacity onPress={onClose}>
                            {/* <Icon name="close" size={24} color={isDarkMode ? '#f2f2f7' : '#121212'} /> */}
                        </TouchableOpacity>
                    </View>

                    <ViewShot ref={viewRef} options={{ format: 'png', quality: 0.8 }} style={{ backgroundColor: isDarkMode ? '#121212' : '#f2f2f7' , padding: 8,}}>
                        {showSummary && showLeftGrid && showRightGrid && (
                            <View style={styles.summaryContainer}>
                                <View style={styles.summaryInner}>
                                    <View style={styles.topSection}>
                                        <Text style={styles.bigNumber}>{hasTotal?.toLocaleString()}</Text>
                                        <View style={styles.statusContainer}>
                                            <Text style={[
                                                styles.statusText,
                                                tradeStatus === 'win' ? styles.statusActive : styles.statusInactive
                                            ]}>WIN</Text>
                                            <Text style={[
                                                styles.statusText,
                                                tradeStatus === 'fair' ? styles.statusActive : styles.statusInactive
                                            ]}>FAIR</Text>
                                            <Text style={[
                                                styles.statusText,
                                                tradeStatus === 'lose' ? styles.statusActive : styles.statusInactive
                                            ]}>LOSE</Text>
                                        </View>
                                        <Text style={styles.bigNumber}>{wantsTotal?.toLocaleString()}</Text>
                                    </View>
                                    <View style={styles.progressContainer}>
                                        <View style={styles.progressBar}>
                                            <View style={[styles.progressLeft, { width: progressBarStyle.left }]} />
                                            <View style={[styles.progressRight, { width: progressBarStyle.right }]} />
                                        </View>
                                    </View>
                                    <View style={styles.labelContainer}>
                                        <Text style={styles.offerLabel}>YOUR OFFER</Text>
                                        <Text style={styles.dividerText}>|</Text>
                                        <Text style={styles.offerLabel}>THEIR OFFER</Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {showProfitLoss && (
                            <View style={styles.profitLossBox}>
                                <Text style={[
                                    styles.profitLossNumber,
                                    { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }
                                ]}>
                                    {Math.abs(profitLoss).toLocaleString()}
                                </Text>
                            </View>
                        )}

                        <View style={styles.tradeContainer}>
                            {renderGrid(hasItems, true)}
                            {showLeftGrid && showRightGrid && (
                                <View style={styles.transferIcon} />
                            )}
                            {renderGrid(wantsItems, false)}
                        </View>

                        {/* {showNotes && description && (
                            <Text style={styles.description}>Note: {description}</Text>
                        )} */}
                    </ViewShot>

                    <View style={styles.toggleContainer}>
                        {renderToggleButton('stats-chart', 'Summary', showSummary, setShowSummary, (!showLeftGrid && showRightGrid) || (showLeftGrid && !showRightGrid))}
                        {renderToggleButton('trending-up', 'Profit/Loss', showProfitLoss, setShowProfitLoss)}
                        {/* {renderToggleButton('grid', 'Left Grid', showLeftGrid, setShowLeftGrid)} */}
                        {/* {renderToggleButton('grid', 'Right Grid', showRightGrid, setShowRightGrid)} */}
                        {/* {renderToggleButton('ribbon', 'Badges', showBadges, setShowBadges)} */}
                        {/* {renderToggleButton('document-text', 'Notes', showNotes, setShowNotes)} */}
                    </View>

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.buttonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                            <Text style={styles.buttonText}>Share</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
            {/* </ScrollView> */}
        </Modal>
    );
};

const getStyles = (isDarkMode) => StyleSheet.create({
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
       
        
    },
    modalContent: {
        backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
        borderRadius: 12,
        width: '98%',
        // maxHeight: '90%',
        // padding: 8,
        // alignItems:'center',
        // flex:1
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: isDarkMode ? '#f2f2f7' : '#121212',
         padding: 8,
    },
    summaryContainer: {
        width: '100%',
        marginBottom: 8,
    },
    summaryInner: {
        backgroundColor: isDarkMode ? '#5c4c49' : 'rgba(255, 255, 255, 0.9)',
        borderRadius: 12,
        padding: 12,
        shadowColor: 'rgba(255, 255, 255, 0.9)',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 2,
    },
    topSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    bigNumber: {
        fontSize: 24,
        fontWeight: 'bold',
        color: isDarkMode ? 'white' : '#333',
        textAlign: 'center',
        minWidth: 100,
    },
    statusContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        borderRadius: 16,
        padding: 4,
        minWidth: 120,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        paddingHorizontal: 8,
    },
    statusActive: {
        color: isDarkMode ? 'white' : '#333',
    },
    statusInactive: {
        color: isDarkMode ? '#999' : '#999',
    },
    progressContainer: {
        marginVertical: 4,
    },
    progressBar: {
        height: 4,
        flexDirection: 'row',
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: '#f0f0f0',
    },
    progressLeft: {
        height: '100%',
        backgroundColor: config.colors.hasBlockGreen,
        transition: 'width 0.3s ease',
    },
    progressRight: {
        height: '100%',
        backgroundColor: '#f3d0c7',
        transition: 'width 0.3s ease',
    },
    labelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 4,
    },
    offerLabel: {
        fontSize: 10,
        color: isDarkMode ? '#999' : '#666',
        fontWeight: '600',
        paddingHorizontal: 8,
    },
    dividerText: {
        fontSize: 12,
        color: '#999',
        paddingHorizontal: 4,
    },
    profitLossBox: {
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        marginBottom: 8,
    },
    profitLossNumber: {
        fontSize: 32,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    tradeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    itemsContainer: {
        flex: 1,
        width: '48%',
    },
    gridContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        backgroundColor: isDarkMode ? '#5c4c49' : '#f3d0c7',
        borderRadius: 4,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgb(255, 102, 102)',
    },
    gridItemWrapper: {
        width: '33.33%',
        aspectRatio: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: 'rgb(255, 102, 102)',
        position: 'relative',
    },
    gridItem: {
        flex: 1,
        backgroundColor: isDarkMode ? '#5c4c49' : '#f3d0c7',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '10%',
    },
    gridItemImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'contain',
        borderRadius: 5,
    },
    transferIcon: {
        width: 5,
        alignItems: 'center',
    },
    description: {
        fontSize: 14,
        color: isDarkMode ? '#f2f2f7' : '#121212',
        marginTop: 8,
        padding: 8,
        backgroundColor: isDarkMode ? '#333' : '#f5f5f5',
        borderRadius: 8,
    },
    toggleContainer: {
        marginVertical: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
        borderRadius: 12,
        padding: 8,

    },
    toggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isDarkMode ? '#333' : '#fff',
        paddingVertical: 4,
        paddingHorizontal: 12,
        borderRadius: 20,
        gap: 4,
    },
    toggleButtonActive: {
        backgroundColor: config.colors.hasBlockGreen,
    },
    toggleButtonDisabled: {
        backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
    },
    toggleButtonText: {
        fontSize: 10,
        color: isDarkMode ? '#f2f2f7' : '#666',
        fontWeight: '500',
    },
    toggleButtonTextActive: {
        color: 'white',
        fontWeight: '600',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 16,
         padding: 8,
    },
    cancelButton: {
        backgroundColor: config.colors.wantBlockRed,
        borderRadius: 8,
        padding: 10,
        width: '48%',
        alignItems: 'center',
    },
    shareButton: {
        backgroundColor: config.colors.hasBlockGreen,
        borderRadius: 8,
        padding: 10,
        width: '48%',
        alignItems: 'center',
    },
    buttonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: 'bold',
    },
    itemBadgesContainer: {
        position: 'absolute',
        bottom: '1%',
        right: '5%',
        flexDirection: 'row',
        gap: 0,
    },
    badge: {
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: '50%',
        marginHorizontal: 1,
    },
    badgeText: {
        color: 'white',
        fontSize: 6,
        fontWeight: 'bold',
        lineHeight: 10,
    },
});

export default ShareTradeModal; 