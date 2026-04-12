/**
 * Unified character state validator
 * Enforces consistency across location, schedule, mood, money, memory, and dialogue
 * 
 * Core principle: One truth, carried everywhere
 * - Character card location MUST match where they actually are
 * - Schedule MUST affect availability and tone
 * - Memory MUST change behavior probability
 * - Mood MUST gate choices
 * - Money MUST pressure decisions
 * - Scene generation MUST respect app state
 * - Dialogue MUST reflect current context
 */

export const CharacterStateValidator = {
  /**
   * Validate location consistency across all systems
   * Character location should be SOURCE OF TRUTH for:
   * - Card display, scene presence, NPC availability, text response pace
   */
  validateLocationTruth(character, currentScene) {
    const errors = [];

    // Check 1: Card location must match resolved location
    if (character.current_home_location_id && character.resolved_current_location_id) {
      if (character.current_home_location_id !== character.resolved_current_location_id) {
        if (character.resolved_presence_status !== 'traveling') {
          errors.push({
            type: 'location_mismatch',
            message: `Card says ${character.current_home_location_id} but app thinks ${character.resolved_current_location_id}`,
            severity: 'critical',
          });
        }
      }
    }

    // Check 2: If character is in a scene, they must be at that location
    if (currentScene && currentScene.location_id) {
      if (character.resolved_current_location_id !== currentScene.location_id) {
        errors.push({
          type: 'scene_location_mismatch',
          message: `Character displayed in scene at ${currentScene.location_id} but card shows ${character.resolved_current_location_id}`,
          severity: 'critical',
        });
      }
    }

    // Check 3: Location visibility state should match presence
    if (character.resolved_presence_status === 'sleeping' && character.location_visibility_state !== 'hidden') {
      errors.push({
        type: 'visibility_mismatch',
        message: `Character is sleeping but visibility is ${character.location_visibility_state}, should be hidden`,
        severity: 'high',
      });
    }

    return errors;
  },

  /**
   * Validate schedule affects real behavior
   * Schedule should gate: availability, response speed, energy level, stress
   */
  validateScheduleInfluence(character, currentTime) {
    const errors = [];
    const hour = currentTime.getHours();

    // Check 1: If character is at work, they shouldn't respond instantly
    if (character.resolved_presence_status === 'at_work') {
      // This should influence response_speed in dialogue system
      // Not a direct validation, but a behavior gate
    }

    // Check 2: If character is sleeping, they can't be messaging
    if (character.resolved_presence_status === 'sleeping') {
      errors.push({
        type: 'sleep_availability_violation',
        message: `Character is sleeping but available for messaging`,
        severity: 'high',
      });
    }

    // Check 3: After schedule violation (leaving early, skipping), create consequence record
    if (character.schedule_override_active) {
      // This should affect mood, money, and relationship for next interaction
    }

    return errors;
  },

  /**
   * Validate memory affects present behavior
   * Remembered events should influence: dialogue probability, location comfort, choices
   */
  validateMemoryBehaviorInfluence(character, recentMemories) {
    const influence = {
      dialogue_filters: [],
      location_comfort_adjustments: {},
      choice_probability_shifts: {},
    };

    if (!recentMemories || recentMemories.length === 0) return influence;

    recentMemories.forEach(memory => {
      // Memory should NOT be decorative—it should change behavior
      if (memory.emotional_impact === 'negative') {
        // Reduce willingness to return to location where trauma happened
        if (memory.location_id) {
          influence.location_comfort_adjustments[memory.location_id] = -30;
        }
        // Make character more defensive in dialogue
        influence.dialogue_filters.push('more_guarded');
      }

      if (memory.emotional_impact === 'positive' && memory.lesson_learned) {
        // Increase trust with people involved
        // Willingness to try similar experiences again
        influence.choice_probability_shifts['trust_increase'] = 15;
      }
    });

    return influence;
  },

  /**
   * Validate mood gates choices
   * Mood should prevent/encourage actions before they happen
   */
  validateMoodInfluence(character) {
    const gates = {
      canGoOut: true,
      canSpendMoney: true,
      canAcceptInvitation: true,
      canFlirt: true,
      canConflict: false,
      messageLength: 'normal',
    };

    const mood = character.emotional_state;

    // Devastated: less likely to go out, spend, socialize
    if (mood === 'sad' || mood === 'grief') {
      gates.canGoOut = false;
      gates.canAcceptInvitation = false;
      gates.messageLength = 'short_or_absent';
    }

    // Anxious: shorter, faster replies, avoids conflict
    if (mood === 'anxious' || mood === 'overwhelmed') {
      gates.canConflict = false;
      gates.messageLength = 'short';
    }

    // In love: more messages, faster replies, more detail
    if (mood === 'love' || mood === 'infatuation') {
      gates.messageLength = 'long';
    }

    // Broke: no expensive activities
    if (character.current_balance < 200) {
      gates.canSpendMoney = false;
    }

    return gates;
  },

  /**
   * Validate relationship history affects present interaction
   * Same sentence lands differently depending on relationship state
   */
  validateRelationshipInfluence(character, targetCharacter, relationshipState) {
    const interpretation = {
      assumeGoodIntent: true,
      willingnessToHelp: 'default',
      responseSpeed: 'normal',
      defensiveness: 0, // 0-100
    };

    if (!relationshipState) return interpretation;

    // High trust: assume good intent, help faster
    if (relationshipState.trust_score > 75) {
      interpretation.assumeGoodIntent = true;
      interpretation.responseSpeed = 'fast';
    }

    // Tension: assume bad intent, slower response
    if (relationshipState.tension_score > 50) {
      interpretation.assumeGoodIntent = false;
      interpretation.defensiveness = relationshipState.tension_score;
      interpretation.responseSpeed = 'slow';
    }

    // Romantic: warmer tone, more detail, callbacks to shared memory
    if (relationshipState.romantic_score > 60) {
      interpretation.willingnessToHelp = 'high';
    }

    return interpretation;
  },

  /**
   * Validate money pressure shapes decisions
   * Broke characters behave differently than wealthy ones
   */
  validateMoneyInfluence(character) {
    const pressure = {
      stressLevel: 0, // 0-100
      spendingRestraint: 'unrestricted',
      workMotivation: 'normal',
      acceptCheaperAlternatives: false,
    };

    const balance = character.current_balance || 0;

    // Under $500: high stress, can't waste money
    if (balance < 500) {
      pressure.stressLevel = 80;
      pressure.spendingRestraint = 'critical';
      pressure.workMotivation = 'high'; // More desperate to earn
      pressure.acceptCheaperAlternatives = true;
    }

    // $500-$2000: moderate stress, careful spending
    if (balance >= 500 && balance < 2000) {
      pressure.stressLevel = 40;
      pressure.spendingRestraint = 'cautious';
    }

    // Over $5000: low stress, comfortable
    if (balance > 5000) {
      pressure.stressLevel = 10;
      pressure.spendingRestraint = 'relaxed';
    }

    return pressure;
  },

  /**
   * Validate scene generation inherits app reality
   * Images must confirm what the app knows, not contradict it
   */
  validateSceneGeneration(scene, characters, location, timeOfDay, mood) {
    const integrity = {
      shouldHaveEmotionalNeutralité: false,
      shouldLookCrowded: false,
      shouldLookPrivate: false,
      timeOfDayMatches: true,
      peoplePresent: [],
    };

    // Scene should match location privacy rules
    if (location.location_type === 'character_specific') {
      integrity.shouldLookPrivate = true;
      // Only residents + invited visitors should appear
    }

    // Scene should match time of day
    if (timeOfDay < 6 || timeOfDay > 23) {
      integrity.shouldLookPrivate = true; // Late night, fewer people
    }

    // Emotional context: if character is grieving, scene should reflect that (or they're masking)
    if (mood === 'grief' || mood === 'devastated') {
      integrity.shouldHaveEmotionalNeutralité = false; // Scene must show sadness unless personality is "hard to read"
    }

    return integrity;
  },

  /**
   * Validate aftermath preservation
   * Events should leave fingerprints for days/weeks, not disappear
   */
  validateAftermathTracking(character, recentEvents) {
    const aftermathState = {
      moodCarryover: 0, // How long mood persists (days)
      trustShift: 0, // Change in specific relationships
      routineChange: null, // New avoidance, new pattern
      consequenceActive: false,
    };

    if (!recentEvents || recentEvents.length === 0) return aftermathState;

    recentEvents.forEach(event => {
      // Major event should ripple for 3-7 days minimum
      const daysSinceEvent = Math.floor((Date.now() - new Date(event.timestamp)) / (1000 * 60 * 60 * 24));

      if (event.event_type === 'breakup_event' && daysSinceEvent < 7) {
        aftermathState.moodCarryover = 7;
        aftermathState.trustShift = -15;
        aftermathState.routineChange = 'avoid_locations_with_ex';
        aftermathState.consequenceActive = true;
      }

      if (event.event_type === 'medical_event' && daysSinceEvent < 3) {
        aftermathState.moodCarryover = 3;
        aftermathState.consequenceActive = true; // Reduced energy
      }
    });

    return aftermathState;
  },

  /**
   * Detect contradictions between systems
   * Return array of contradictions that need resolution
   */
  detectContradictions(character, scene, schedule, financial, relationship) {
    const contradictions = [];

    // Contradiction 1: Marked at work but shown partying
    if (character.resolved_presence_status === 'at_work' && scene?.tone === 'party') {
      contradictions.push({
        type: 'presence_tone_mismatch',
        severity: 'critical',
        fix: 'Character cannot be partying while at work',
      });
    }

    // Contradiction 2: Asleep but sending energetic replies
    if (character.resolved_presence_status === 'sleeping' && character.messageLength === 'long') {
      contradictions.push({
        type: 'sleep_energy_mismatch',
        severity: 'high',
        fix: 'Remove message or change location status',
      });
    }

    // Contradiction 3: Low funds but making expensive plans without explanation
    if (financial.current_balance < 100 && scene?.suggestedSpending > 50) {
      contradictions.push({
        type: 'money_spending_mismatch',
        severity: 'high',
        fix: 'Character should suggest cheaper alternatives or explain financial situation',
      });
    }

    // Contradiction 4: Says they're home while card shows gym
    if (character.current_activity?.includes('home') && character.resolved_current_location_name?.includes('Gym')) {
      contradictions.push({
        type: 'dialogue_location_mismatch',
        severity: 'critical',
        fix: 'Update location or dialogue to match',
      });
    }

    // Contradiction 5: Mood devastated but dialogue is emotionally blank
    if (character.emotional_state === 'grief' && scene?.emotionalTone === 'neutral') {
      contradictions.push({
        type: 'mood_tone_mismatch',
        severity: 'high',
        fix: 'Scene tone should reflect emotional state (or character is masking)',
      });
    }

    return contradictions;
  },
};

export default CharacterStateValidator;