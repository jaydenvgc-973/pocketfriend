import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REGRESSION TRACER — Find Where Shared Truth Diverges
 * 
 * This function traces through key systems and logs exactly where
 * they read truth from, when they diverge, and why.
 * 
 * Traces:
 * 1. Scene Page image generation — what source is used?
 * 2. Residential identity resolution — internal family lookup working?
 * 3. Avatar/reference image passing — are avatars correct?
 * 4. allPossibleNpcs / selectedNpcs building — who gets included?
 * 5. Character type filters — are they applied correctly?
 * 6. Zone image selection — is zone being honored?
 * 7. Location/residence logic — is residence state correct?
 * 8. Automatic narrative scheduler — why aren't they firing?
 * 9. Travel automation — why are characters frozen?
 * 10. Schedule evaluation — are schedules being read?
 * 11. Current location/presence writeback — is state persisted?
 */

async function traceCharacterAvatarSources(char) {
  console.log(`\n🔍 TRACING AVATAR SOURCES FOR: ${char.name} (${char.id})`);
  console.log(`${'─'.repeat(70)}`);

  const sources = {
    avatar_url: { value: char.avatar_url, isSet: !!char.avatar_url },
    image_avatar_url: { value: char.image_avatar_url, isSet: !!char.image_avatar_url },
    reference_image_urls: { value: char.reference_image_urls?.length || 0, isSet: !!(char.reference_image_urls?.length) },
    generated_avatar_urls: { value: char.generated_avatar_urls?.length || 0, isSet: !!(char.generated_avatar_urls?.length) },
  };

  console.log(`Sources available:`);
  Object.entries(sources).forEach(([field, data]) => {
    const icon = data.isSet ? '✅' : '❌';
    console.log(`  ${icon} ${field}: ${data.isSet ? data.value : 'MISSING'}`);
  });

  // Check internal family
  if (char.family_members && char.family_members.length > 0) {
    console.log(`\nInternal Family Members (${char.family_members.length}):`);
    char.family_members.forEach(fm => {
      const hasAvatar = !!fm.photo_url;
      const icon = hasAvatar ? '✅' : '❌';
      console.log(`  ${icon} ${fm.name} (${fm.relationship_type}): ${hasAvatar ? fm.photo_url : 'NO AVATAR'}`);
    });
  }

  // Check fictional relationships (NPCs without character links)
  const ficNpcs = (char.fictional_relationships || []).filter(r => !r.related_character_id);
  if (ficNpcs.length > 0) {
    console.log(`\nFictional Relationships/NPCs (${ficNpcs.length}):`);
    ficNpcs.forEach(rel => {
      const hasAvatar = !!rel.avatar_url;
      const icon = hasAvatar ? '✅' : '❌';
      console.log(`  ${icon} ${rel.person_name}: ${hasAvatar ? rel.avatar_url : 'NO AVATAR'}`);
    });
  }

  return sources;
}

async function traceCharacterLocationTruth(char) {
  console.log(`\n📍 TRACING LOCATION TRUTH FOR: ${char.name}`);
  console.log(`${'─'.repeat(70)}`);

  const locationFields = {
    resolved_current_location_id: char.resolved_current_location_id,
    current_location_id: char.current_location_id,
    current_home_location_id: char.current_home_location_id,
    home_location_id: char.home_location_id,
  };

  const presenceFields = {
    resolved_current_location_name: char.resolved_current_location_name,
    resolved_location_type: char.resolved_location_type,
    resolved_presence_status: char.resolved_presence_status,
    presence_state: char.presence_state,
    travel_status: char.travel_status,
  };

  console.log(`Location Fields:`);
  Object.entries(locationFields).forEach(([field, value]) => {
    const icon = value ? '✅' : '⚠️';
    console.log(`  ${icon} ${field}: ${value || 'UNSET'}`);
  });

  console.log(`\nPresence Fields:`);
  Object.entries(presenceFields).forEach(([field, value]) => {
    const icon = value ? '✅' : '⚠️';
    console.log(`  ${icon} ${field}: ${value || 'UNSET'}`);
  });

  // Resolve which location is authoritative
  const primaryLoc = char.resolved_current_location_id || char.current_location_id;
  const secondaryLoc = char.current_home_location_id || char.home_location_id;

  if (!primaryLoc && !secondaryLoc) {
    console.log(`\n⚠️ CRITICAL: No location assigned at all`);
  } else {
    console.log(`\nAuthoritative Location Resolution:`);
    console.log(`  Primary (current): ${primaryLoc || 'NONE (should be home)'}`);
    console.log(`  Secondary (home): ${secondaryLoc || 'NONE'}`);
  }

  return { locationFields, presenceFields };
}

async function traceResidentialSceneImageGeneration(char, location) {
  console.log(`\n🎬 TRACING RESIDENTIAL SCENE IMAGE GENERATION`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`Character: ${char.name}`);
  console.log(`Location: ${location.name} (${location.category})`);
  console.log(`Is Home: ${location.category === 'home'}`);

  if (location.category !== 'home') {
    console.log(`⚠️ Not a home location — skipping residential trace`);
    return;
  }

  // Who SHOULD be here?
  const residents = location.resident_character_ids || [];
  const familyMembers = location.resident_family_members || [];

  console.log(`\nResidents by entity record:`);
  console.log(`  Character IDs: ${residents.length}`);
  if (residents.length > 0) {
    console.log(`    ${residents.join(', ')}`);
  }
  console.log(`  Family Members: ${familyMembers.length}`);
  familyMembers.forEach(fm => {
    console.log(`    • ${fm.name} (${fm.relationship_type || 'Family'}): ${fm.source_character_id || 'no source'}`);
  });

  // Check internal family files
  console.log(`\nInternal family avatars available:`);
  if (char.family_members && char.family_members.length > 0) {
    char.family_members.forEach(fm => {
      const icon = fm.photo_url ? '✅' : '❌';
      console.log(`  ${icon} ${fm.name}: ${fm.photo_url || 'MISSING'}`);
    });
  } else {
    console.log(`  ⚠️ No family_members array on character`);
  }

  // Zone images
  console.log(`\nZone images available:`);
  const zones = location.zones || [];
  zones.forEach(zone => {
    const hasImages = zone.image_urls && zone.image_urls.length > 0;
    const icon = hasImages ? '✅' : '❌';
    console.log(`  ${icon} ${zone.zone_name}: ${hasImages ? zone.image_urls.length + ' images' : 'NO IMAGES'}`);
  });
}

async function traceNarrativeEligibility(char) {
  console.log(`\n📖 TRACING NARRATIVE ELIGIBILITY FOR: ${char.name}`);
  console.log(`${'─'.repeat(70)}`);

  const checks = {};

  // Check 1: Character type
  const charType = char.character_type;
  const supportsNarratives = ['active_created_character', 'npc_fictitious_character'].includes(charType);
  checks.characterType = { type: charType, eligible: supportsNarratives };
  console.log(`${supportsNarratives ? '✅' : '❌'} Character Type: ${charType} (narratives: ${supportsNarratives ? 'YES' : 'NO'})`);

  // Check 2: Status
  const isActive = char.status === 'active';
  checks.isActive = isActive;
  console.log(`${isActive ? '✅' : '❌'} Status: ${char.status}`);

  // Check 3: Test/diagnostic flag
  const isTest = char.is_test_character || char.diagnostic_only;
  checks.isTest = isTest;
  console.log(`${!isTest ? '✅' : '❌'} Not test/diagnostic: ${isTest ? 'IS TEST' : 'PRODUCTION'}`);

  // Check 4: Last narrative
  const lastNarrative = char.last_autonomous_narrative_at;
  const daysSince = lastNarrative ? Math.floor((Date.now() - new Date(lastNarrative)) / (1000 * 60 * 60 * 24)) : null;
  const isOverdue = !lastNarrative || daysSince > 1;
  checks.narrativeOverdue = isOverdue;
  console.log(`${isOverdue ? '✅' : '⚠️'} Narrative Status: ${lastNarrative ? `${daysSince} days ago` : 'NEVER'} ${isOverdue ? '(OVERDUE)' : ''}`);

  // Check 5: Narrative mode
  const narrativeMode = char.narrative_mode;
  checks.narrativeMode = narrativeMode;
  console.log(`${narrativeMode === 'auto' || !narrativeMode ? '✅' : '⚠️'} Narrative Mode: ${narrativeMode || 'DEFAULT (auto)'}`);

  // Overall eligibility
  const eligible = supportsNarratives && isActive && !isTest && (isOverdue || !lastNarrative);
  console.log(`\n${eligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE'} for automatic narrative`);

  if (!eligible) {
    const reasons = [];
    if (!supportsNarratives) reasons.push('unsupported character type');
    if (!isActive) reasons.push('not active');
    if (isTest) reasons.push('test/diagnostic');
    if (!isOverdue && lastNarrative) reasons.push('narrative too recent');
    console.log(`   Reasons: ${reasons.join(', ')}`);
  }

  return checks;
}

async function traceScheduleState(char) {
  console.log(`\n⏰ TRACING SCHEDULE STATE FOR: ${char.name}`);
  console.log(`${'─'.repeat(70)}`);

  const schedule = char.character_schedule_profile;

  if (!schedule) {
    console.log(`❌ NO SCHEDULE PROFILE`);
    return { hasSchedule: false };
  }

  console.log(`✅ Schedule Profile Found:`);
  console.log(`  Wake Time: ${schedule.wake_time || 'UNSET'}`);
  console.log(`  Sleep Time: ${schedule.sleep_time || 'UNSET'}`);
  console.log(`  Work Start: ${schedule.work_start || 'UNSET'}`);
  console.log(`  Work End: ${schedule.work_end || 'UNSET'}`);
  console.log(`  Timezone: ${schedule.timezone || 'UNSET'}`);

  // Work details
  const workDetails = char.work_details;
  const workLocations = char.work_location_ids || [];

  if (!workDetails && workLocations.length === 0) {
    console.log(`\n⚠️ No work assignment`);
  } else {
    console.log(`\n📋 Work Status:`);
    if (workDetails) {
      console.log(`  Job Title: ${workDetails.job_title}`);
      console.log(`  Status: ${workDetails.employment_status}`);
    }
    console.log(`  Work Locations: ${workLocations.length}`);
  }

  return { hasSchedule: true, schedule, workDetails };
}

async function traceTravelEligibility(char) {
  console.log(`\n✈️ TRACING TRAVEL ELIGIBILITY FOR: ${char.name}`);
  console.log(`${'─'.repeat(70)}`);

  const checks = {};

  // Check 1: Character type
  const charType = char.character_type;
  const canTravel = ['active_created_character', 'npc_fictitious_character'].includes(charType);
  console.log(`${canTravel ? '✅' : '❌'} Character Type: ${charType} (can travel: ${canTravel ? 'YES' : 'NO'})`);

  // Check 2: Current location state
  const currentLocation = char.resolved_current_location_id || char.current_location_id;
  const homeLocation = char.current_home_location_id || char.home_location_id;
  const travelStatus = char.travel_status;
  const presenceState = char.presence_state;

  console.log(`\nLocation State:`);
  console.log(`  Current: ${currentLocation || 'NONE (at home)'}`);
  console.log(`  Home: ${homeLocation || 'UNSET'}`);
  console.log(`  Travel Status: ${travelStatus || 'not_traveling'}`);
  console.log(`  Presence State: ${presenceState || 'home'}`);

  // Check 3: Last travel update
  const lastTravel = char.last_travel_update_at;
  const hoursSinceTravel = lastTravel ? Math.floor((Date.now() - new Date(lastTravel)) / (1000 * 60 * 60)) : null;
  console.log(`\nTravel History:`);
  console.log(`  Last Update: ${lastTravel ? hoursSinceTravel + 'h ago' : 'NEVER'}`);

  // Overall eligibility
  const eligible = canTravel && homeLocation && (!currentLocation || currentLocation === homeLocation);
  console.log(`\n${eligible ? '✅ ELIGIBLE' : '⚠️'} for travel`);

  return { canTravel, currentLocation, homeLocation, eligible };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`REGRESSION SOURCE-OF-TRUTH TRACER`);
    console.log(`User: ${user.email}`);
    console.log(`${'='.repeat(80)}`);

    // Get sample character
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

    const sampleChar = characters.filter(c => !c.is_test_character && !c.diagnostic_only)[0];

    if (!sampleChar) {
      console.log(`\n⚠️ No active production characters found`);
      return Response.json({ error: 'No characters to trace' }, { status: 400 });
    }

    console.log(`\nTracing: ${sampleChar.name}`);

    // TRACE 1: Avatar sources
    await traceCharacterAvatarSources(sampleChar);

    // TRACE 2: Location truth
    await traceCharacterLocationTruth(sampleChar);

    // TRACE 3: Schedule state
    await traceScheduleState(sampleChar);

    // TRACE 4: Narrative eligibility
    await traceNarrativeEligibility(sampleChar);

    // TRACE 5: Travel eligibility
    await traceTravelEligibility(sampleChar);

    // TRACE 6: Residential scene (if at home)
    const currentLocation = sampleChar.resolved_current_location_id || sampleChar.current_location_id;
    const homeLocation = sampleChar.current_home_location_id || sampleChar.home_location_id;
    const atLocation = currentLocation || homeLocation;

    if (atLocation) {
      const location = await base44.entities.LocationReference.get(atLocation);
      if (location) {
        await traceResidentialSceneImageGeneration(sampleChar, location);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`TRACE COMPLETE`);
    console.log(`${'='.repeat(80)}\n`);

    return Response.json({
      status: 'traced',
      character: sampleChar.name,
      user: user.email,
    });
  } catch (error) {
    console.error('Trace failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});