import React from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import { View, Text, TouchableOpacity } from 'react-native';

const ProfileAdminActions = ({
  isAdmin, isDarkMode, isBanned, mergedUser,
  handleApplyStrike, handleMuteUser, handleUnbanUser,
  handlePromoteModerator, handleDemoteModerator,
  isBabyMod = false, isModerator = false, isStaff = true,
  canManageBabyMod = false, targetIsBabyMod = false,
  canManageModerator = false,
  handleMakeBabyMod, handleRemoveBabyMod,
  canManageBadges = false, targetIsTrusted = false, targetIsCMSR = false, targetIsHelper = false,
  handleMakeTrusted, handleRemoveTrusted, handleMakeCMSR, handleRemoveCMSR, handleMakeHelper, handleRemoveHelper,
  canResetAvatar = false, targetHasAvatar = false, handleResetAvatar,
  handleDeleteUserData, deletingUser = false,
  canDeleteUser = false,
  canSanction = true, targetIsStaff = false,
}) => {
  const c = getThemeColors(isDarkMode);
  const isBabyModOnly = isBabyMod && !isAdmin && !isModerator;
  // A user who only holds the delegated grant is not staff: no strikes, no
  // mute, no unban, no badges, no delete. They get exactly two chips —
  // Make/Remove Moderator and Make/Remove Junior Mod — and nothing else.
  const grantOnly = !isStaff;
  // 2026-09-20: staff are off-limits to non-admins. Folded into the same flag
  // the strike/mute/unban blocks already test, so there is one condition to
  // reason about rather than two overlapping ones.
  const noSanctions = grantOnly || !canSanction;

  const bg = c.bg;
  const border = c.border;
  const dim = c.textMuted;

  const Chip = ({ label, color = '#6366f1', onPress }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6,
        backgroundColor: color + '18', borderWidth: 1, borderColor: color + '40' }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ marginTop: 6, backgroundColor: bg, borderRadius: 12,
      borderWidth: 1, borderColor: border, marginBottom: 10, padding: 12 }}>

      <Text style={{ fontSize: 10, fontWeight: '700', color: dim,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        {isAdmin ? 'Admin' : isModerator ? 'Moderator' : grantOnly ? 'Staff Access' : 'Junior Mod'}
      </Text>

      {targetIsStaff && !canSanction && (
        <Text style={{ fontSize: 11, color: dim, marginBottom: 10, lineHeight: 16 }}>
          This user is a staff member. Only an admin can strike, mute or ban them.
        </Text>
      )}

      {!isBabyModOnly && !noSanctions && (
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 10, color: dim, fontWeight: '600', marginBottom: 6 }}>Strikes</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Chip label="Strike 1" color="#f97316" onPress={() => handleApplyStrike(1)} />
            <Chip label="Strike 2" color="#ef4444" onPress={() => handleApplyStrike(2)} />
            <Chip label="Strike 3" color="#dc2626" onPress={() => handleApplyStrike(3)} />
          </View>
        </View>
      )}

      {!noSanctions && (
      <View style={{ marginBottom: 10 }}>
        <Text style={{ fontSize: 10, color: dim, fontWeight: '600', marginBottom: 6 }}>
          Mute{isBabyModOnly ? ' (max 2h)' : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(isBabyModOnly
            ? [5, 15, 30, 45, 60, 120]
            : [5, 10, 30, 45, 60, 120]
          ).map(m => (
            <Chip key={m} label={m >= 60 ? `${m/60}h` : `${m}m`} color="#7c3aed" onPress={() => handleMuteUser(m)} />
          ))}
        </View>
      </View>
      )}

      {!noSanctions && <View style={{ height: 1, backgroundColor: border, marginBottom: 10 }} />}

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {!isBabyModOnly && !noSanctions && isBanned && (
          <Chip label="Unban" color="#10b981" onPress={handleUnbanUser} />
        )}
        {/* Admins, plus anyone holding the delegated JMD grant — see
            canManageModerator in BottomDrawer. Shown to grant-only users too:
            promoting a Moderator is the point of the grant, so it is the one
            staff action that survives the `grantOnly` suppression below. */}
        {(isAdmin || canManageModerator) && (
          <Chip
            label={mergedUser?.isModerator ? 'Remove Mod' : 'Make Mod'}
            color={mergedUser?.isModerator ? '#f59e0b' : '#3b82f6'}
            onPress={mergedUser?.isModerator ? handleDemoteModerator : handlePromoteModerator}
          />
        )}
        {canManageBabyMod && (
          <Chip
            label={targetIsBabyMod ? 'Remove Junior Mod' : 'Make Junior Mod'}
            color={targetIsBabyMod ? '#f59e0b' : '#3b82f6'}
            onPress={targetIsBabyMod ? handleRemoveBabyMod : handleMakeBabyMod}
          />
        )}
        {canManageBadges && (
          <Chip
            label={targetIsTrusted ? 'Remove Trusted' : 'Make Trusted'}
            color={targetIsTrusted ? '#f59e0b' : '#10b981'}
            onPress={targetIsTrusted ? handleRemoveTrusted : handleMakeTrusted}
          />
        )}
        {canManageBadges && (
          <Chip
            label={targetIsCMSR ? 'Remove CMSR' : 'Make CMSR'}
            color={targetIsCMSR ? '#f59e0b' : '#6366f1'}
            onPress={targetIsCMSR ? handleRemoveCMSR : handleMakeCMSR}
          />
        )}
        {canManageBadges && (
          <Chip
            label={targetIsHelper ? 'Remove Helper' : 'Make Helper'}
            color={targetIsHelper ? '#f59e0b' : '#14b8a6'}
            onPress={targetIsHelper ? handleRemoveHelper : handleMakeHelper}
          />
        )}
        {/* Only offered when there's a custom avatar to clear — resetting a
            user who already shows the default would be a no-op. */}
        {canResetAvatar && targetHasAvatar && handleResetAvatar && (
          <Chip
            label="Reset Avatar"
            color="#ef4444"
            onPress={handleResetAvatar}
          />
        )}
      </View>

      {/* Delete User Data — admins + owner UID */}
      {canDeleteUser && handleDeleteUserData && (
        <>
          <View style={{ height: 1, backgroundColor: border, marginTop: 10, marginBottom: 10 }} />
          <TouchableOpacity
            onPress={handleDeleteUserData}
            disabled={deletingUser}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: '#dc262618',
              borderWidth: 1,
              borderColor: '#dc262640',
              opacity: deletingUser ? 0.5 : 1,
            }}
          >
            {deletingUser ? (
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#dc2626' }}>Deleting...</Text>
            ) : (
              <>
                <Text style={{ fontSize: 14 }}>🗑️</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#dc2626' }}>Delete This User</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

export default React.memo(ProfileAdminActions);
