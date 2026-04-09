/**
 * User Engagement Incentive Engine (Phase 3)
 * Three-layer system: Popups (attention) + Badges (visibility) + Rewards (motivation)
 */

/**
 * Popup triggers based on real events
 * Returns { show: boolean, type, message, context }
 */
export function evaluatePopupTrigger(eventType, context) {
  const triggers = {
    GROUP_CHAT: {
      show: context?.hasNewMessages && !context?.isRead,
      type: 'group_chat',
      message: context?.lastMessage?.length > 50 
        ? `${context.participantCount} characters discussing: "${context.lastMessage.substring(0, 40)}..."`
        : context?.lastMessage || 'Group chat is active',
      cooldown: 5 * 60 * 1000, // 5 mins
    },
    MOMENT_CREATED: {
      show: context?.isNewMoment && !context?.isSeen,
      type: 'moment',
      message: `This feels like a moment worth saving — "${context.momentTitle}"`,
      cooldown: 10 * 60 * 1000, // 10 mins
    },
    ACHIEVEMENT_UNLOCKED: {
      show: context?.isNewAchievement,
      type: 'achievement',
      message: `🏆 Achievement unlocked: ${context.achievementName}`,
      cooldown: 0, // show once per achievement
    },
    ACHIEVEMENT_PROGRESS: {
      show: context?.progressPercent > 75 && context?.lastShowedAt < context?.progressChangedAt,
      type: 'achievement_progress',
      message: `You're ${context.progressPercent}% toward unlocking ${context.achievementName}`,
      cooldown: 30 * 60 * 1000, // 30 mins
    },
    OUTING_COMPLETED: {
      show: context?.isComplete && !context?.isAcknowledged,
      type: 'outing_complete',
      message: `Outing completed with ${context.participantNames?.join(', ')}`,
      cooldown: 15 * 60 * 1000, // 15 mins
    },
  };

  return triggers[eventType] || { show: false };
}

/**
 * Badge visibility based on unread/unacknowledged activity
 * Returns { show: boolean, type, count?, highlight? }
 */
export function evaluateBadge(featureType, context) {
  const badges = {
    GROUP_CHAT: {
      show: context?.unreadCount > 0,
      type: 'dot',
      count: context?.unreadCount,
      highlight: context?.unreadCount > 3,
    },
    MOMENTS: {
      show: context?.newMomentCount > 0 || context?.unsavedCount > 0,
      type: context?.unsavedCount > 0 ? 'highlight' : 'dot',
      count: context?.newMomentCount + context?.unsavedCount,
    },
    ACHIEVEMENTS: {
      show: context?.unviewedCount > 0 || context?.nearUnlockCount > 0,
      type: context?.unviewedCount > 0 ? 'highlight' : 'dot',
      count: context?.unviewedCount + context?.nearUnlockCount,
    },
    OUTINGS: {
      show: context?.pendingInviteCount > 0,
      type: 'highlight',
      count: context?.pendingInviteCount,
    },
  };

  return badges[featureType] || { show: false };
}

/**
 * Determine reward for user action
 * Returns { type, title, description, xp?, badge? }
 */
export function calculateReward(actionType, context) {
  const rewards = {
    FIRST_GROUP_CHAT: {
      type: 'achievement',
      title: 'Conversation Starter',
      description: 'You joined a group chat',
      xp: 10,
      badge: 'first_group_chat',
    },
    FIRST_MOMENT: {
      type: 'achievement',
      title: 'Memory Keeper',
      description: 'You saved your first moment',
      xp: 15,
      badge: 'first_moment',
    },
    OUTING_ATTENDED: {
      type: 'progression',
      title: 'Social Butterfly',
      description: `You attended an outing with ${context?.characterCount || 1} character(s)`,
      xp: 20,
    },
    RELATIONSHIP_MILESTONE: {
      type: 'progression',
      title: `${context?.relationshipType} Bond Deepened`,
      description: `Your relationship with ${context?.characterName} has grown closer`,
      xp: 25,
      badge: `milestone_${context?.relationshipType}`,
    },
    DAILY_ENGAGEMENT: {
      type: 'streak',
      title: 'Daily Explorer',
      description: `${context?.streakDays} day streak of using the app`,
      xp: 5 * context?.streakDays,
    },
    ACHIEVEMENT_UNLOCKED: {
      type: 'achievement',
      title: `${context?.achievementName}`,
      description: context?.achievementDescription,
      xp: context?.xpReward || 50,
    },
  };

  return rewards[actionType] || { type: 'none' };
}

/**
 * Should show popup (check cooldowns)
 */
export function shouldShowPopup(popupType, lastShownAt) {
  const cooldowns = {
    group_chat: 5 * 60 * 1000,
    moment: 10 * 60 * 1000,
    achievement: 0, // always show
    achievement_progress: 30 * 60 * 1000,
    outing_complete: 15 * 60 * 1000,
  };

  if (!lastShownAt) return true;
  const cooldown = cooldowns[popupType] || 0;
  const timeSinceShown = Date.now() - new Date(lastShownAt).getTime();
  return timeSinceShown > cooldown;
}

/**
 * Clear badge after user acknowledges content
 */
export function clearBadge(featureType, context) {
  return {
    feature: featureType,
    clearedAt: new Date().toISOString(),
    context,
  };
}

/**
 * Evaluate if reward should be shown (not all actions get rewards)
 */
export function shouldShowReward(actionType, context) {
  const rewardableActions = [
    'FIRST_GROUP_CHAT',
    'FIRST_MOMENT',
    'OUTING_ATTENDED',
    'RELATIONSHIP_MILESTONE',
    'DAILY_ENGAGEMENT',
    'ACHIEVEMENT_UNLOCKED',
  ];
  return rewardableActions.includes(actionType);
}