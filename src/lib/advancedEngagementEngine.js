/**
 * Advanced Engagement Engine (Phase 4)
 * Character-driven prompts + FOMO + priority ranking
 */

/**
 * Character reacts to events and initiates engagement
 * Returns { initiator: characterName, type, message, tone }
 */
export function generateCharacterPrompt(characterId, characterName, eventType, context) {
  const personality = context?.personality || 'neutral';
  const relationshipCloseness = context?.relationshipScore || 50;

  const prompts = {
    MISSED_OUTING: {
      close: `"You should've come with us — ${context?.eventName} was wild."`,
      casual: `"We went to ${context?.eventName} earlier. You would've liked it."`,
      playful: `"You're missing all the fun! We're doing ${context?.eventName} again."`,
      distant: `"We had an outing. It was something."`,
    },
    GROUP_CHAT_ACTIVE: {
      close: `"Check the group chat — we're talking about you!"`,
      casual: `"Something's going on in the group chat right now."`,
      playful: `"You need to see what's happening in chat 😆"`,
      distant: `"There's activity in the group chat."`,
    },
    MOMENT_CREATED: {
      close: `"That thing that just happened? That was actually a moment."`,
      casual: `"You should save that. It was worth it."`,
      playful: `"Moments like that are why we do this."`,
      distant: `"You might want to record that."`,
    },
    ACHIEVEMENT_PROGRESS: {
      close: `"You're so close to unlocking ${context?.achievementName}. Keep going!"`,
      casual: `"You're progressing toward ${context?.achievementName}."`,
      playful: `"Almost there with ${context?.achievementName} — don't stop now!"`,
      distant: `"Progress update on ${context?.achievementName}."`,
    },
  };

  const toneLookup = relationshipCloseness > 70 ? 'close' : relationshipCloseness > 40 ? 'casual' : relationshipCloseness > 20 ? 'playful' : 'distant';
  const promptOptions = prompts[eventType] || {};
  const selectedPrompt = promptOptions[toneLookup] || promptOptions.distant;

  return {
    initiator: characterName,
    type: eventType,
    message: selectedPrompt,
    tone: toneLookup,
  };
}

/**
 * FOMO System — things happen without the user
 * Returns { triggered: boolean, message, intensity, missedWhat }
 */
export function evaluateFOMOTrigger(eventType, context) {
  const fomoEvents = {
    CONVERSATION_WITHOUT_USER: {
      triggered: context?.conversationLength > 5 && context?.userParticipation === 0,
      message: `Group chat kept going without you — ${context?.participantCount} people were talking.`,
      intensity: 'medium',
      missedWhat: 'conversation',
    },
    OUTING_HAPPENED: {
      triggered: context?.outingOccurred && !context?.userAttended,
      message: `You missed the outing! ${context?.characterNames?.join(', ')} went to ${context?.locationName}.`,
      intensity: 'high',
      missedWhat: 'outing',
    },
    MOMENT_WITHOUT_USER: {
      triggered: context?.momentCreated && !context?.userInvolved,
      message: `A moment just happened, and you weren't there.`,
      intensity: 'medium',
      missedWhat: 'moment',
    },
    DECISION_MADE: {
      triggered: context?.decisionReached && !context?.userInvolved,
      message: `The group made a decision without you: ${context?.decision}`,
      intensity: 'medium',
      missedWhat: 'decision',
    },
  };

  return fomoEvents[eventType] || { triggered: false };
}

/**
 * Priority ranking — what deserves attention first
 * Returns { priority: 'high' | 'medium' | 'low', reason }
 */
export function rankEventPriority(eventType, context) {
  const priorities = {
    // HIGH PRIORITY
    DIRECT_INVITE: { priority: 'high', reason: 'Direct invitation' },
    ACHIEVEMENT_UNLOCKED: { priority: 'high', reason: 'Achievement unlocked' },
    RELATIONSHIP_MILESTONE: { priority: 'high', reason: 'Important relationship moment' },
    EMOTIONAL_MOMENT: { priority: 'high', reason: 'Significant emotional event' },

    // MEDIUM PRIORITY
    GROUP_CHAT_NEW: { priority: 'medium', reason: 'New group activity' },
    MOMENT_CREATED: { priority: 'medium', reason: 'Moment created' },
    FRIEND_INITIATED: { priority: 'medium', reason: 'Friend started conversation' },
    PROGRESS_UPDATE: { priority: 'medium', reason: 'Achievement progress' },

    // LOW PRIORITY
    BACKGROUND_UPDATE: { priority: 'low', reason: 'Background activity' },
    PASSIVE_PROGRESSION: { priority: 'low', reason: 'Passive progression' },
    SYSTEM_NOTIFICATION: { priority: 'low', reason: 'System update' },
  };

  return priorities[eventType] || { priority: 'low', reason: 'Unknown event' };
}

/**
 * Choose which prompt to show if multiple events
 * Returns highest priority event
 */
export function selectHighestPriorityPrompt(events) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return events.sort((a, b) => {
    const aPriority = priorityOrder[a.priority] || 3;
    const bPriority = priorityOrder[b.priority] || 3;
    return aPriority - bPriority;
  })[0];
}

/**
 * Personalize prompt based on character relationship
 */
export function personalizePrompt(basePrompt, characterName, relationshipTone) {
  const personalizations = {
    close: `${characterName} here — ${basePrompt}`,
    casual: `FYI from ${characterName}: ${basePrompt}`,
    playful: `Yo, ${characterName} says: ${basePrompt}`,
    distant: `Message from ${characterName}: ${basePrompt}`,
  };

  return personalizations[relationshipTone] || basePrompt;
}

/**
 * Check if enough time has passed for next prompt
 */
export function shouldShowEngagementPrompt(lastPromptAt, minSpacingMs = 300000) {
  if (!lastPromptAt) return true;
  const timeSincePrompt = Date.now() - new Date(lastPromptAt).getTime();
  return timeSincePrompt > minSpacingMs;
}