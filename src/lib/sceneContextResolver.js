/**
 * SCENE CONTEXT RESOLVER
 *
 * Single authoritative source for "what is happening and where" before any image generation.
 *
 * Resolution order:
 *   1. Detect place reference from latest message
 *   2. Try exact saved-location match
 *   3. Try learned alias match
 *   4. Try category-based soft match
 *   5. If unresolved → trigger popup (handled upstream)
 *   6. Infer activity from message + character state
 *   7. Determine render_readiness
 *   8. Return unified scene context object
 *
 * Rule: No image may be generated directly from chat text alone.
 *       All images must flow through this resolver first.
 */

// ── RABBIT HOLE TYPE INFERENCE ─────────────────────────────────────────────────
// Maps (label keywords + activity keywords) → environment type
const RABBIT_HOLE_TYPE_MAP = [
  {
    type: 'dance_studio',
    labelKeywords: ['studio', 'set', 'rehearsal', 'rehearsal space', 'practice space', 'dance'],
    activityKeywords: ['choreo', 'choreography', 'rehearse', 'rehearsing', 'dance', 'run-through', 'run through', 'moves', 'blocking', 'practice'],
    environmentDesc: 'professional dance rehearsal studio, open practice floor, mirrored walls, rehearsal lighting, movement-ready space',
    exclusions: ['not residential', 'not bedroom', 'not home interior', 'not apartment', 'no bed', 'no domestic furniture', 'no living room', 'no nightstands'],
  },
  {
    type: 'music_studio',
    labelKeywords: ['studio', 'recording', 'booth', 'tracking', 'session'],
    activityKeywords: ['recording', 'record', 'vocals', 'laying down', 'track', 'mixing', 'music session', 'in the booth', 'session'],
    environmentDesc: 'professional music recording studio, mixing console, acoustic panels, studio monitors, recording booth glass',
    exclusions: ['not residential', 'not bedroom', 'not home interior', 'no bed', 'no domestic furniture'],
  },
  {
    type: 'production_set',
    labelKeywords: ['set', 'shoot', 'film set', 'stage', 'production'],
    activityKeywords: ['filming', 'shooting', 'on set', 'camera', 'blocking', 'scene', 'director', 'production'],
    environmentDesc: 'professional film or TV production set, camera equipment, lighting rigs, crew equipment, production atmosphere',
    exclusions: ['not residential', 'not bedroom', 'not home interior', 'no bed', 'no domestic furniture'],
  },
  {
    type: 'backstage',
    labelKeywords: ['backstage', 'green room', 'dressing room', 'wings'],
    activityKeywords: ['before show', 'pre-show', 'getting ready', 'warming up', 'wait', 'waiting'],
    environmentDesc: 'backstage area, dressing room or green room, theatrical/concert backstage environment',
    exclusions: ['not residential', 'not bedroom', 'not home interior', 'no bed'],
  },
  {
    type: 'gym_studio',
    labelKeywords: ['gym', 'fitness', 'training', 'workout'],
    activityKeywords: ['workout', 'training', 'lifting', 'exercise', 'conditioning', 'cardio'],
    environmentDesc: 'gym or fitness training facility, workout equipment, athletic training environment',
    exclusions: ['not residential', 'not bedroom', 'not home interior', 'no bed'],
  },
  {
    type: 'office',
    labelKeywords: ['office', 'meeting', 'conference', 'boardroom', 'work'],
    activityKeywords: ['meeting', 'conference', 'work', 'presentation', 'call', 'zoom'],
    environmentDesc: 'professional office environment, conference room or work desk area',
    exclusions: ['not residential', 'not bedroom', 'not home interior', 'no bed'],
  },
  {
    type: 'clinic_medical',
    labelKeywords: ['clinic', 'hospital', 'doctor', 'appointment', 'medical'],
    activityKeywords: ['appointment', 'checkup', 'doctor', 'waiting', 'treatment'],
    environmentDesc: 'medical clinic or hospital environment, examination room or waiting area',
    exclusions: ['not residential', 'not home interior', 'no bed unless patient bed'],
  },
  {
    type: 'restaurant_kitchen',
    labelKeywords: ['kitchen', 'restaurant', 'chef'],
    activityKeywords: ['cooking', 'chef', 'prep', 'service'],
    environmentDesc: 'professional restaurant kitchen, commercial cooking environment',
    exclusions: ['not residential', 'not home kitchen', 'not bedroom'],
  },
  {
    type: 'generic_social_space',
    labelKeywords: ['out', 'around', 'somewhere', 'event', 'venue', 'place'],
    activityKeywords: ['socializing', 'hanging', 'event', 'gathering'],
    environmentDesc: 'social venue or public space appropriate to the context',
    exclusions: ['not residential', 'not bedroom', 'not home interior'],
  },
];

/**
 * Infer rabbit hole type from label + activity text
 */
export function inferRabbitHoleType(label = '', activityText = '') {
  const labelLower = (label || '').toLowerCase();
  const activityLower = (activityText || '').toLowerCase();
  const combined = `${labelLower} ${activityLower}`;

  for (const entry of RABBIT_HOLE_TYPE_MAP) {
    const labelHit = entry.labelKeywords.some(k => labelLower.includes(k));
    const activityHit = entry.activityKeywords.some(k => activityLower.includes(k));

    // Both match → highest confidence
    if (labelHit && activityHit) return entry;
    // Activity alone narrows it down when label is generic
    if (activityHit && labelLower.length < 15) return entry;
    // Label alone if very specific
    if (labelHit && entry.labelKeywords.some(k => k.length >= 5 && labelLower.includes(k))) return entry;
  }

  return null;
}

/**
 * Infer current activity from message content + character state
 */
export function inferActivity(messageContent = '', character = null) {
  const text = (messageContent || '').toLowerCase();
  const currentActivity = character?.current_activity || '';

  const activityPatterns = [
    { activity: 'rehearsing_dance', patterns: ['choreo', 'choreography', 'rehearse', 'rehearsing', 'run-through', 'run through', 'moves', 'dance practice', 'running the choreo', 'get these moves'] },
    { activity: 'recording', patterns: ['recording', 'in the booth', 'laying down', 'tracking vocals', 'record vocals', 'session'] },
    { activity: 'filming', patterns: ['filming', 'on camera', 'on set', 'take', 'scene', 'shoot'] },
    { activity: 'exercising', patterns: ['workout', 'lifting', 'cardio', 'training', 'gym', 'conditioning', 'sweat'] },
    { activity: 'sleeping', patterns: ['sleeping', 'asleep', 'sleep', 'nap', 'dozing', 'passed out', 'knocked out'] },
    { activity: 'eating', patterns: ['eating', 'food', 'lunch', 'dinner', 'breakfast', 'meal', 'hungry', 'ordering'] },
    { activity: 'traveling', patterns: ['on my way', 'driving', 'uber', 'headed', 'pulling up', 'in the car', 'road', 'flight', 'flying', 'at the airport'] },
    { activity: 'resting', patterns: ['chilling', 'relaxing', 'resting', 'laid back', 'downtime', 'kicking back'] },
    { activity: 'socializing', patterns: ['hanging', 'with people', 'link', 'kick it', 'party', 'vibing'] },
    { activity: 'working', patterns: ['working', 'at work', 'clocked in', 'on the clock', 'shift'] },
    { activity: 'waiting', patterns: ['waiting', 'wait', 'bout to', 'about to start', 'getting ready to'] },
  ];

  for (const { activity, patterns } of activityPatterns) {
    if (patterns.some(p => text.includes(p))) return activity;
  }

  // Fall back to character's stored current activity
  if (currentActivity && currentActivity !== 'none') return currentActivity;

  return 'present'; // neutral / unknown
}

/**
 * Build a rabbit hole environment prompt block.
 * Returns { envPrompt, exclusionBlock, rabbitHoleType }
 */
export function buildRabbitHoleEnvironmentPrompt(rabbitHoleLabel, activity, needsSummary = null) {
  const typeEntry = inferRabbitHoleType(rabbitHoleLabel, activity);

  const envDesc = typeEntry?.environmentDesc
    || `${rabbitHoleLabel || 'off-screen location'} — interior, functional, non-residential environment`;

  const exclusions = typeEntry?.exclusions || [
    'not residential', 'not bedroom', 'not home interior', 'not apartment', 'no bed', 'no domestic furniture',
  ];

  // Activity descriptor in prompt
  const activityDesc = activity && activity !== 'present'
    ? `, character is ${activity.replace(/_/g, ' ')}`
    : '';

  // Needs modifiers — affect scene energy, not location
  let needsModifier = '';
  if (needsSummary) {
    const energy = needsSummary.energy_band;
    const social = needsSummary.social_band;
    const mental = needsSummary.mental_band;

    if (energy === 'strong' && (activity?.includes('rehearsing') || activity?.includes('exercise'))) {
      needsModifier = ', high energy and focus, active movement-ready posture';
    } else if (energy === 'low' || energy === 'critical') {
      needsModifier = ', visibly tired, resting between moments, lower energy presence';
    }
    if (social === 'low' || social === 'critical') {
      needsModifier += ', isolated corner of the space, solo presence, not social';
    }
    if (mental === 'low' || mental === 'critical') {
      needsModifier += ', tense or distracted atmosphere, heavy presence';
    }
  }

  const envPrompt = `${envDesc}${activityDesc}${needsModifier}`;
  const exclusionBlock = exclusions.join(', ');

  return {
    envPrompt,
    exclusionBlock,
    rabbitHoleTypeName: typeEntry?.type || 'generic_offscreen',
  };
}

/**
 * Determine render readiness based on available context.
 * Returns 'ready' | 'blocked_missing_location' | 'blocked_missing_activity' | 'wait_for_context'
 */
export function determineRenderReadiness(locationMode, locationLabel, activity, rabbitHoleType) {
  // No location at all
  if (!locationMode || locationMode === 'unknown') return 'blocked_missing_location';

  // Rabbit hole with no label
  if (locationMode === 'rabbit_hole' && !locationLabel) return 'blocked_missing_location';

  // Rabbit hole: if label is too generic AND no activity, wait
  const genericLabels = ['somewhere', 'out', 'around', 'a place', 'the place'];
  if (locationMode === 'rabbit_hole' && genericLabels.includes((locationLabel || '').toLowerCase()) && (!activity || activity === 'present')) {
    return 'wait_for_context';
  }

  // Built location is fine to render
  if (locationMode === 'built_location') return 'ready';

  // Rabbit hole with a meaningful label → ready
  if (locationMode === 'rabbit_hole' && locationLabel && locationLabel.length >= 3) return 'ready';

  return 'ready';
}

/**
 * Build the full scene context object from character state + latest message.
 * This is the object that image generation MUST receive.
 */
export function buildSceneContext(character, latestMessage = '', locationMap = {}) {
  if (!character) return null;

  const isRabbitHole = character.resolved_presence_status === 'rabbit_hole' || character.is_rabbit_hole === true;
  const rabbitHoleLabel = character.rabbit_hole_label || character.resolved_current_location_name || null;
  const activity = inferActivity(latestMessage, character);

  let locationMode = 'unknown';
  let locationId = null;
  let locationLabel = null;
  let locationSource = 'fallback';

  if (isRabbitHole) {
    locationMode = 'rabbit_hole';
    locationLabel = rabbitHoleLabel;
    locationSource = character.resolved_source_reason || 'chat_rabbit_hole';
  } else if (character.resolved_current_location_id && locationMap[character.resolved_current_location_id]) {
    locationMode = 'built_location';
    locationId = character.resolved_current_location_id;
    locationLabel = locationMap[character.resolved_current_location_id]?.name || character.resolved_current_location_name;
    locationSource = character.resolved_source_reason || 'system';
  } else if (character.current_home_location_id && locationMap[character.current_home_location_id]) {
    locationMode = 'built_location';
    locationId = character.current_home_location_id;
    locationLabel = locationMap[character.current_home_location_id]?.name;
    locationSource = 'fallback_home';
  }

  const rabbitHoleType = isRabbitHole ? inferRabbitHoleType(rabbitHoleLabel, latestMessage) : null;

  const renderReadiness = determineRenderReadiness(locationMode, locationLabel, activity, rabbitHoleType?.type);

  const mustNotFallbackToHome = isRabbitHole || (character.resolved_presence_status === 'at_work') || (character.resolved_presence_status === 'at_school');

  return {
    character_id: character.id,
    location_mode: locationMode,
    location_id: locationId,
    location_label: locationLabel,
    location_source: locationSource,
    rabbit_hole_type: rabbitHoleType?.type || null,
    rabbit_hole_env_desc: rabbitHoleType?.environmentDesc || null,
    rabbit_hole_exclusions: rabbitHoleType?.exclusions || null,
    activity,
    activity_text: latestMessage,
    render_readiness: renderReadiness,
    use_saved_location_images: !isRabbitHole,
    must_not_fallback_to_home: mustNotFallbackToHome,
    presence_status: character.resolved_presence_status,
  };
}