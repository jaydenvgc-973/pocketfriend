/**
 * Event Chains + Story Arc Engine (Phase 5)
 * Actions create follow-up events. Repeated chains form long-term story arcs.
 */

/**
 * Evaluate whether an event should create follow-up events
 * Returns array of follow-up events to trigger
 */
export function generateEventChain(eventType, context) {
  const chains = {
    OUTING_COMPLETED: [
      {
        type: 'GROUP_CHAT_FOLLOWUP',
        delay: 5 * 60 * 1000, // 5 mins after
        content: `Just got back from ${context?.locationName}`,
        participants: context?.attendees,
      },
      {
        type: 'MOMENT_SUGGESTION',
        delay: 10 * 60 * 1000,
        content: `Remember that moment at ${context?.locationName}?`,
      },
    ],
    ARGUMENT_STARTED: [
      {
        type: 'CHARACTER_REACTION',
        delay: 30 * 60 * 1000,
        content: 'Still thinking about what happened earlier',
        characterId: context?.characterId,
      },
      {
        type: 'RECONCILIATION_OPPORTUNITY',
        delay: 4 * 60 * 60 * 1000, // 4 hours
        content: "Maybe it's time to talk",
      },
    ],
    EMOTIONAL_VULNERABILITY: [
      {
        type: 'CHARACTER_SUPPORT',
        delay: 60 * 60 * 1000, // 1 hour
        content: `How are you holding up?`,
        characterId: context?.closeCharacterId,
      },
      {
        type: 'MEMORY_CREATED',
        delay: 2 * 60 * 60 * 1000,
        content: 'That conversation felt important',
      },
    ],
    BAD_WORKDAY: [
      {
        type: 'HOME_PULL',
        delay: 30 * 60 * 1000,
        content: 'Just want to go home and rest',
      },
      {
        type: 'FRIEND_CHECKIN',
        delay: 3 * 60 * 60 * 1000,
        content: `Bad day. Needed to vent.`,
      },
    ],
    ACHIEVEMENT_UNLOCKED: [
      {
        type: 'CHARACTER_ACKNOWLEDGE',
        delay: 10 * 60 * 1000,
        content: `You really did that!`,
        characterId: context?.closeCharacterId,
      },
      {
        type: 'NEW_OPPORTUNITY',
        delay: 24 * 60 * 60 * 1000,
        content: 'Because of what you achieved, a new opportunity opened up',
      },
    ],
  };

  return chains[eventType] || [];
}

/**
 * Story Arc Types and Structures
 */
export const STORY_ARCS = {
  RELATIONSHIP_GROWTH: {
    stages: ['acquaintance', 'friendly', 'trusting', 'close', 'bonded'],
    triggeringEvents: ['shared_outing', 'vulnerability', 'support', 'inside_joke', 'conflict_resolved'],
    behaviorChanges: {
      trusting: { tone: 'warmer', inviteFrequency: 'more', openness: 'high' },
      bonded: { tone: 'intimate', inviteFrequency: 'frequent', openness: 'very_high' },
    },
  },
  WORK_BURNOUT: {
    stages: ['engaged', 'overworking', 'stressed', 'burned_out', 'recovering'],
    triggeringEvents: ['late_work', 'skipped_outing', 'low_energy', 'health_decline', 'social_withdrawal'],
    behaviorChanges: {
      stressed: { socialEnergy: 'low', homeTime: 'increased', moodTone: 'irritable' },
      burned_out: { socialEnergy: 'very_low', homeTime: 'high', moodTone: 'exhausted' },
      recovering: { socialEnergy: 'slowly_increasing', homeTime: 'normalized', moodTone: 'hopeful' },
    },
  },
  FAMILY_BONDING: {
    stages: ['distant', 'reconnecting', 'closer', 'strong_bond'],
    triggeringEvents: ['family_outing', 'family_call', 'shared_responsibility', 'support_given'],
    behaviorChanges: {
      closer: { homePull: 'increased', familyPriority: 'high', messaging: 'more_frequent' },
      strong_bond: { homePull: 'very_high', familyPriority: 'highest', messaging: 'very_frequent' },
    },
  },
  CONFLICT_ARC: {
    stages: ['tension', 'conflict', 'awkward', 'attempt_reconciliation', 'resolved_or_ended'],
    triggeringEvents: ['argument', 'misunderstanding', 'support_declined', 'effort_to_reconcile'],
    behaviorChanges: {
      conflict: { tone: 'cold', distance: 'increased', invites: 'less' },
      awkward: { tone: 'polite_but_distant', distance: 'moderate', invites: 'declining' },
      attempt_reconciliation: { tone: 'cautious', distance: 'decreasing', invites: 'tentative' },
    },
  },
  PERSONAL_GROWTH: {
    stages: ['stagnant', 'motivated', 'progressing', 'changed'],
    triggeringEvents: ['achievement', 'healthy_choice', 'new_habit', 'reflection'],
    behaviorChanges: {
      progressing: { confidence: 'increasing', initiative: 'higher', decisions: 'more_intentional' },
      changed: { confidence: 'high', initiative: 'very_high', decisions: 'deliberate' },
    },
  },
};

/**
 * Detect if repeated related events are forming an arc
 */
export function detectFormingArc(recentEvents) {
  const eventCounts = {};
  recentEvents.forEach(e => {
    eventCounts[e.arcType] = (eventCounts[e.arcType] || 0) + 1;
  });

  // Arc forms after 3+ related events
  const formingArcs = Object.entries(eventCounts)
    .filter(([_, count]) => count >= 3)
    .map(([arcType]) => arcType);

  return formingArcs;
}

/**
 * Apply arc-based behavior changes to character
 */
export function applyArcBehaviorChanges(character, arcType, arcStage) {
  const arc = STORY_ARCS[arcType];
  if (!arc) return {};

  const changes = arc.behaviorChanges[arcStage] || {};
  const update = {};

  // Translate arc behavior changes to character field updates
  if (changes.tone) {
    // Tone affects communication style
    update.communication_style = changes.tone;
  }
  if (changes.moodTone) {
    // Mood affects emotional state
    if (changes.moodTone === 'exhausted') {
      update.mental_value = Math.max(20, (character.mental_value || 50) - 20);
    } else if (changes.moodTone === 'hopeful') {
      update.mental_value = Math.min(100, (character.mental_value || 50) + 15);
    }
  }
  if (changes.homePull) {
    // Home pull affects location decisions (handled in postShiftExitLogic)
    update.home_pull_strength = changes.homePull === 'increased' ? 60 : changes.homePull === 'very_high' ? 85 : 30;
  }
  if (changes.socialEnergy) {
    // Social energy affects social_value
    const energyMap = { very_low: 30, low: 45, slowly_increasing: 60, normalized: 70 };
    if (energyMap[changes.socialEnergy]) {
      update.social_value = energyMap[changes.socialEnergy];
    }
  }

  return update;
}

/**
 * Generate arc evolution note for character
 */
export function generateArcNote(arcType, arcStage, character) {
  const notes = {
    RELATIONSHIP_GROWTH: {
      trusting: `${character.name} has been opening up more lately.`,
      bonded: `${character.name} feels like a true friend now.`,
    },
    WORK_BURNOUT: {
      stressed: `${character.name} seems stretched thin.`,
      burned_out: `${character.name} is completely exhausted.`,
      recovering: `${character.name} is slowly finding balance again.`,
    },
    FAMILY_BONDING: {
      closer: `${character.name} has been thinking about family more.`,
      strong_bond: `Family is clearly ${character.name}'s priority right now.`,
    },
    CONFLICT_ARC: {
      tension: `There's unspoken tension between ${character.name} and them.`,
      awkward: `Things feel awkward after what happened.`,
      attempt_reconciliation: `${character.name} is trying to patch things up.`,
    },
    PERSONAL_GROWTH: {
      progressing: `${character.name} is making real changes.`,
      changed: `${character.name} is a different person than before.`,
    },
  };

  const noteMap = notes[arcType] || {};
  return noteMap[arcStage] || null;
}

/**
 * Check if arc should progress to next stage
 */
export function shouldProgressArc(arcType, currentStage, triggeringEventCount) {
  const progressionThresholds = {
    RELATIONSHIP_GROWTH: 4,
    WORK_BURNOUT: 5,
    FAMILY_BONDING: 3,
    CONFLICT_ARC: 3,
    PERSONAL_GROWTH: 4,
  };

  const threshold = progressionThresholds[arcType] || 4;
  return triggeringEventCount >= threshold;
}

/**
 * Memory should reflect arc progression
 */
export function createArcMemory(character, arcType, arcStage, description) {
  return {
    character_id: character.id,
    title: `${arcType.replace(/_/g, ' ')} — ${arcStage.replace(/_/g, ' ')}`,
    description,
    emotional_impact: `This moment marked a shift in my ${arcType.toLowerCase()}`,
    lesson_learned: `Every step of this journey matters`,
    source_context: 'story_arc',
  };
}