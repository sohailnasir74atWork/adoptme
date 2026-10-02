import React from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import { View, Text, TouchableOpacity } from 'react-native';

const ProfileAdminActions = ({
  isAdmin, isDarkMode, isBanned, mergedUser,
  handleApplyStrike, handleMuteUser, handleUnbanUser,
  handleDemoteModerator,
  isBabyMod = false, isModerator = false, isStaff = true,
  canManageBabyMod = false, targetIsBabyMod = false,
  canManageModerator = false,
  handleRemoveBabyMod,
  canManageBadges = false, targetIsTrusted = false, targetIsCMSR = false, targetIsHelper = false,
  badgeAllowed = true, targetSquad = 0, badgeMinSquad = 3,
  handleMakeTrusted, handleRemoveTrusted, handleMakeCMSR, handleRemoveCMSR, handleMakeHelper, handleRemoveHelper,
  canResetAvatar = false, targetHasAvatar = false, handleResetAvatar,
  handleDeleteUserData, deletingUser = false,
  canDeleteUser = false,
  canSanction = true, targetIsStaff = false,
}) => {
  const c = getThemeColors(isDarkMode);
  const isBabyModOnly = isBabyMod && !isAdmin && !isModerator;
  // 2026-09-20: staff are off-limits to non-admins. Folded into the same flag
  // the strike/mute/unban blocks already test, so there is one condition to
  // reason about rather than two overlapping ones.
  const noSanctions = !isStaff || !canSanction;
  // Badges: a grant needs badgeMinSquad squad friends; removing never does.
  const showMakeBadge = canManageBadges && badgeAllowed;

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
        {isAdmin ? 'Admin' : isModerator ? 'Moderator' : 'Junior Mod'}
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
        {/* MODs and JMDs are elected (Elections screen); nobody appoints them
            by hand. Admins can still remove one who abuses the role. */}
        {canManageModerator && mergedUser?.isModerator && (
          <Chip label="Remove Mod" color="#f59e0b" onPress={handleDemoteModerator} />
        )}
        {canManageBabyMod && targetIsBabyMod && (
          <Chip label="Remove Junior Mod" color="#f59e0b" onPress={handleRemoveBabyMod} />
        )}
        {canManageBadges && (targetIsTrusted
          ? <Chip label="Remove Trusted" color="#f59e0b" onPress={handleRemoveTrusted} />
          : showMakeBadge && <Chip label="Make Trusted" color="#10b981" onPress={handleMakeTrusted} />)}
        {canManageBadges && (targetIsCMSR
          ? <Chip label="Remove CMSR" color="#f59e0b" onPress={handleRemoveCMSR} />
          : showMakeBadge && <Chip label="Make CMSR" color="#6366f1" onPress={handleMakeCMSR} />)}
        {canManageBadges && (targetIsHelper
          ? <Chip label="Remove Helper" color="#f59e0b" onPress={handleRemoveHelper} />
          : showMakeBadge && <Chip label="Make Helper" color="#14b8a6" onPress={handleMakeHelper} />)}
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

      {canManageBadges && !badgeAllowed && (
        <Text style={{ fontSize: 11, color: dim, marginTop: 10, lineHeight: 16 }}>
          Badges need {badgeMinSquad} squad friends. This player has {targetSquad}.
        </Text>
      )}

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
