// GlobalInviteToast.jsx - Global toast notification for game invites
import React, { useState, useEffect, useRef } from 'react';
import { useGlobalState } from '../../../GlobelStats';
import { listenToUserInvites } from '../utils/gameInviteSystem';
import InviteToast from './InviteToast';

const GlobalInviteToast = () => {
  const { firestoreDB, user } = useGlobalState();
  const [toastVisible, setToastVisible] = useState(false);
  const [toastData, setToastData] = useState(null);
  const lastInviteIdRef = useRef(null);

  useEffect(() => {
    if (!firestoreDB || !user?.id) return;

    const unsubscribe = listenToUserInvites(firestoreDB, user.id, (invites) => {
      // Show toast for new invites
      if (invites.length > 0) {
        const latestInvite = invites[0];
        const inviteId = `${latestInvite.roomId}-${latestInvite.timestamp}`;
        
        // Only show if it's a new invite (not the same one)
        if (inviteId !== lastInviteIdRef.current) {
          lastInviteIdRef.current = inviteId;
          setToastData({
            fromUserName: latestInvite.fromUserName || 'Someone',
            fromUserAvatar: latestInvite.fromUserAvatar || null,
            roomId: latestInvite.roomId,
          });
          setToastVisible(true);
        }
      }
    });

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  const handleToastPress = () => {
    setToastVisible(false);
    // Note: Navigation will be handled by the existing InviteNotification component
  };

  const handleToastDismiss = () => {
    setToastVisible(false);
  };

  return (
    <InviteToast
      visible={toastVisible}
      fromUserName={toastData?.fromUserName}
      fromUserAvatar={toastData?.fromUserAvatar}
      onPress={handleToastPress}
      onDismiss={handleToastDismiss}
    />
  );
};

export default GlobalInviteToast;

