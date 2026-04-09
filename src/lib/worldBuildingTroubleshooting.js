/**
 * World-Building Systems Troubleshooting
 * Unified diagnostic for all 5 phases: work-life balance, location sync,
 * engagement engine, advanced engagement, and story arcs
 */

/**
 * Run comprehensive diagnostics on active character
 */
export async function diagnosticActiveCharacter(character, base44) {
  const issues = [];

  // ─── PHASE 1: WORK-LIFE BALANCE
  if (character.character_type === 'active') {
    // Check if character is stuck at work after hours
    const jobType = (character.work_details?.workplace_type || '').toLowerCase();
    const highDrainJobs = ['hospital', 'clinic', 'school', 'office'];
    const isHighDrain = highDrainJobs.some(j => jobType.includes(j));

    if (character.current_work_location_id === character.resolved_current_location_id) {
      const workEndTime = character.work_end_time || '17:00';
      const now = new Date();
      const currentTimeMin = now.getHours() * 60 + now.getMinutes();
      const [endH, endM] = workEndTime.split(':').map(Number);
      const workEndMin = endH * 60 + endM;

      if (currentTimeMin > workEndMin + 60) {
        // More than 1 hour after work
        const energy = character.energy_value || 75;
        const mental = character.mental_value || 75;

        if (isHighDrain && energy < 50 && mental < 50) {
          issues.push({
            code: 'OVERSTAYING_WITHOUT_REASON',
            severity: 'high',
            message: `${character.name} is at high-drain work location after hours with low energy/mental`,
            suggestion: 'Character should have auto-exited to home',
          });
        }
      }
    }

    // Check if home pull is working for family-oriented characters
    const hasKids = (character.family_members || []).some(f =>
      ['daughter', 'son'].includes(f.relationship_type)
    );
    if (hasKids && character.resolved_presence_status !== 'home') {
      const lateHour = new Date().getHours();
      if (lateHour > 19 && character.resolved_presence_status !== 'heading_home') {
        issues.push({
          code: 'HOME_PULL_NOT_APPLIED',
          severity: 'medium',
          message: `Family-oriented ${character.name} not home late at night`,
          suggestion: 'Home pull should increase likelihood of returning',
        });
      }
    }
  }

  // ─── PHASE 2: LOCATION SYNC
  // Check consistency of location fields
  const locationIssues = [];
  if (character.resolved_current_location_id && character.current_work_location_id) {
    if (character.resolved_current_location_id === character.current_work_location_id) {
      if (!['at_work', 'working'].includes(character.resolved_presence_status)) {
        locationIssues.push({
          code: 'PRESENCE_STATUS_MISMATCH',
          message: `Location is work but status is ${character.resolved_presence_status}`,
        });
      }
    }
  }

  if (character.resolved_current_location_id === character.current_home_location_id) {
    if (character.resolved_presence_status !== 'home') {
      locationIssues.push({
        code: 'PRESENCE_STATUS_MISMATCH',
        message: `Location is home but status is ${character.resolved_presence_status}`,
      });
    }
  }

  // Check for stale location data
  if (character.resolved_last_updated_at) {
    const hoursSinceUpdate =
      (Date.now() - new Date(character.resolved_last_updated_at).getTime()) / (1000 * 3600);
    if (hoursSinceUpdate > 24) {
      locationIssues.push({
        code: 'STALE_LOCATION_DATA',
        message: `Location not updated in ${Math.floor(hoursSinceUpdate)} hours`,
        severity: 'medium',
      });
    }
  }

  issues.push(...locationIssues);

  // ─── PHASE 3-4: ENGAGEMENT
  // Check if character has unacknowledged moments or achievements
  const achievements = await base44.asServiceRole.entities.UserAchievement.filter(
    { character_id: character.id, is_seen: false }
  );
  if (achievements.length > 0) {
    issues.push({
      code: 'UNVIEWED_ACHIEVEMENTS',
      severity: 'low',
      message: `${achievements.length} unviewed achievement(s)`,
      suggestion: 'Badge should be showing on achievements feature',
    });
  }

  // ─── PHASE 5: STORY ARCS
  // Check if patterns are forming
  const recentEvents = await base44.asServiceRole.entities.LifeEvent.filter(
    { character_id: character.id },
    '-timestamp',
    15
  );

  const eventCounts = {};
  recentEvents.forEach(e => {
    if (e.event_type) {
      const arcCategory = getEventArcCategory(e.event_type);
      if (arcCategory) {
        eventCounts[arcCategory] = (eventCounts[arcCategory] || 0) + 1;
      }
    }
  });

  const formingArcs = Object.entries(eventCounts)
    .filter(([_, count]) => count >= 3)
    .map(([arcType]) => arcType);

  if (formingArcs.length > 0 && !character.character_evolution_note) {
    issues.push({
      code: 'ARC_NOT_NOTED',
      severity: 'low',
      message: `Story arc forming (${formingArcs.join(', ')}) but not reflected in character notes`,
      suggestion: 'Character evolution note should document the arc',
    });
  }

  return issues;
}

/**
 * Map event types to story arc categories
 */
function getEventArcCategory(eventType) {
  const arcMap = {
    conflict_event: 'CONFLICT_ARC',
    fight_event: 'CONFLICT_ARC',
    falling_out: 'CONFLICT_ARC',
    grief_event: 'EMOTIONAL_WEIGHT',
    loss_event: 'EMOTIONAL_WEIGHT',
    growth_event: 'PERSONAL_GROWTH',
    healthy_choice_event: 'PERSONAL_GROWTH',
    recovery_event: 'PERSONAL_GROWTH',
    bonding_event: 'RELATIONSHIP_GROWTH',
    emotional_exchange: 'RELATIONSHIP_GROWTH',
    relationship_shift: 'RELATIONSHIP_GROWTH',
  };
  return arcMap[eventType];
}

/**
 * List all issue codes for reference
 */
export const ISSUE_CODES = [
  // Phase 1
  'WORK_EXIT_NOT_TRIGGERED',
  'OVERSTAYING_WITHOUT_REASON',
  'JOB_TYPE_IGNORED',
  'NO_HOME_PRIORITY',

  // Phase 2
  'LOCATION_SYNC_FAILED',
  'CHARACTER_CARD_STALE',
  'TRAVEL_PAGE_OUT_OF_SYNC',
  'PRESENCE_LIST_INCORRECT',
  'LOCATION_NOT_UPDATED_AFTER_ACTION',
  'POST_SHIFT_LOCATION_STALE',
  'STALE_LOCATION_DATA',
  'PRESENCE_STATUS_MISMATCH',

  // Phase 3-4
  'POPUP_NOT_TRIGGERED',
  'POPUP_OVERTRIGGERING',
  'BADGE_INCORRECT',
  'BADGE_NOT_CLEARING',
  'REWARD_NOT_VISIBLE',
  'NO_USER_INCENTIVE',
  'CONTEXT_MISSING',
  'FEATURE_INACTIVE_FEEL',
  'CHARACTER_PROMPT_MISSING',
  'FOMO_NOT_TRIGGERED',
  'FOMO_OVERUSED',
  'PRIORITY_MISORDERED',
  'PROMPT_OVERLOAD',
  'IMPORTANT_EVENT_NOT_SURFACED',
  'LOW_PRIORITY_INTERRUPT',

  // Phase 5
  'EVENT_CHAIN_NOT_TRIGGERED',
  'FOLLOWUP_EVENT_MISSING',
  'EVENT_CHAIN_TIMING_BAD',
  'STORY_ARC_NOT_FORMING',
  'ARC_MEMORY_NOT_USED',
  'ARC_NOT_AFFECTING_BEHAVIOR',
  'ARC_STUCK',
  'REPETITIVE_NARRATIVE_LOOP',
  'ARC_NOT_NOTED',
  'UNVIEWED_ACHIEVEMENTS',
];

/**
 * Run full system check
 */
export async function fullWorldBuildingDiagnostic(allCharacters, base44) {
  const results = [];

  for (const character of allCharacters) {
    if (character.character_type === 'active' && character.status === 'active') {
      const issues = await diagnosticActiveCharacter(character, base44);
      if (issues.length > 0) {
        results.push({
          character: character.name,
          characterId: character.id,
          issueCount: issues.length,
          issues,
        });
      }
    }
  }

  return results;
}