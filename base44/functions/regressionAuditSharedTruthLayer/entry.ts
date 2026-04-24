import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REGRESSION AUDIT — Shared Truth Layer Diagnostic
 * 
 * This function audits the core state resolution pipeline to identify
 * where the app stopped reading from a consistent source of truth.
 * 
 * It traces:
 * - Character location truth (which field is authoritative?)
 * - Scene image generation source (who's selected vs who's present?)
 * - Narrative eligibility (why aren't they firing?)
 * - Travel automation (why are characters frozen?)
 * - Internal family resolution (where are avatars coming from?)
 * - Zone image selection (is it using the right zone?)
 * - Schedule state synchronization (are schedules being read?)
 */

async function auditCharacterTruthState(base44, character) {
  const char = character;
  const issues = [];
  const truths = {};

  // TRUTH SOURCE 1: Current Location (authoritative for presence)
  const locFields = {
    'resolved_current_location_id': char.resolved_current_location_id,
    'current_location_id': char.current_location_id,
    'current_home_location_id': char.current_home_location_id,
    'home_location_id': char.home_location_id,
    'resolved_location_type': char.resolved_location_type,
  };
  truths.locationFields = locFields;

  const primaryLoc = char.resolved_current_location_id || char.current_location_id;
  const secondaryLoc = char.current_home_location_id || char.home_location_id;

  if (!primaryLoc && !secondaryLoc) {
    issues.push('NO_LOCATION_ASSIGNED');
  } else if (primaryLoc && secondaryLoc && primaryLoc !== secondaryLoc && char.resolved_location_type !== 'home') {
    // Character is somewhere other than home
    truths.presentLocation = primaryLoc;
  } else if (secondaryLoc && !primaryLoc) {
    // Character should be home
    truths.presentLocation = secondaryLoc;
    truths.presentType = 'home';
  }

  // TRUTH SOURCE 2: Avatar/Identity Resolution
  const avatarFields = {
    'avatar_url': char.avatar_url,
    'image_avatar_url': char.image_avatar_url,
    'reference_image_urls': char.reference_image_urls?.length || 0,
  };
  truths.avatarFields = avatarFields;

  if (!char.avatar_url && !char.image_avatar_url && (!char.reference_image_urls || char.reference_image_urls.length === 0)) {
    issues.push('NO_AVATAR_OR_REFERENCE');
  }

  // TRUTH SOURCE 3: Family Member Resolution (internal family files)
  if (char.character_type === 'active_created_character' || char.character_type === 'npc_fictitious_character') {
    const familyMembers = char.family_members || [];
    const ficRels = char.fictional_relationships?.filter(r => !r.related_character_id) || [];

    truths.internalFamilyCount = familyMembers.length;
    truths.fictitiousNPCCount = ficRels.length;

    // Check if family members have avatars
    const familyWithoutAvatars = familyMembers.filter(fm => !fm.photo_url);
    if (familyWithoutAvatars.length > 0) {
      issues.push(`FAMILY_MISSING_AVATARS: ${familyWithoutAvatars.map(fm => fm.name).join(', ')}`);
    }
  }

  // TRUTH SOURCE 4: Schedule State
  const scheduleProfile = char.character_schedule_profile;
  const workDetails = char.work_details;
  const workLocations = char.work_location_ids || [];

  truths.scheduleState = {
    hasProfile: !!scheduleProfile,
    wakeTime: scheduleProfile?.wake_time,
    sleepTime: scheduleProfile?.sleep_time,
    workStart: scheduleProfile?.work_start,
    workEnd: scheduleProfile?.work_end,
  };

  truths.workState = {
    hasWorkDetails: !!workDetails,
    jobTitle: workDetails?.job_title,
    locationCount: workLocations.length,
  };

  // TRUTH SOURCE 5: Narrative Eligibility
  const lastNarrative = char.last_autonomous_narrative_at;
  const narrativeMode = char.narrative_mode;
  const isActive = char.status === 'active';
  const isTestChar = char.is_test_character || char.diagnostic_only;

  truths.narrativeState = {
    isActive,
    isTestChar,
    mode: narrativeMode,
    lastNarrative: lastNarrative ? new Date(lastNarrative).toISOString().split('T')[0] : 'never',
    daysSinceNarrative: lastNarrative ? Math.floor((Date.now() - new Date(lastNarrative)) / (1000 * 60 * 60 * 24)) : null,
  };

  if (isActive && !isTestChar && (!narrativeMode || narrativeMode === 'auto')) {
    if (!lastNarrative || Date.now() - new Date(lastNarrative) > 24 * 60 * 60 * 1000) {
      issues.push('NARRATIVE_OVERDUE');
    }
  }

  // TRUTH SOURCE 6: Character Type Simulation Support
  const charType = char.character_type;
  const supportsFullSim = ['active_created_character', 'npc_fictitious_character'].includes(charType);

  truths.characterType = {
    type: charType,
    supportsFullSim,
    shouldHaveSchedule: supportsFullSim,
    shouldHaveNarratives: supportsFullSim,
    shouldTravel: supportsFullSim,
  };

  if (supportsFullSim && !scheduleProfile) {
    issues.push('SIM_CHARACTER_MISSING_SCHEDULE');
  }

  // TRUTH SOURCE 7: Presence State (Scene/Image generation)
  const presenceState = char.presence_state;
  const travelStatus = char.travel_status;
  const resolvedPresenceStatus = char.resolved_presence_status;

  truths.presenceState = {
    presence_state: presenceState,
    travel_status: travelStatus,
    resolved_presence_status: resolvedPresenceStatus,
  };

  if (travelStatus === 'traveling' && presenceState !== 'in_transit') {
    issues.push('TRAVEL_STATE_MISMATCH');
  }

  return {
    characterId: char.id,
    characterName: char.name,
    characterType: char.character_type,
    truths,
    issues,
    isHealthy: issues.length === 0,
  };
}

async function auditLocationTruthState(base44, location) {
  const issues = [];
  const truths = {};

  // TRUTH: Residents
  const residentCharIds = location.resident_character_ids || [];
  const occupancyFields = location.occupancy_by_location_id || {};
  
  truths.residentCharIds = residentCharIds;
  truths.occupancyCount = Object.keys(occupancyFields).length;

  if (residentCharIds.length > 0 && Object.keys(occupancyFields).length === 0) {
    issues.push('RESIDENTS_NOT_IN_OCCUPANCY');
  }

  // TRUTH: Family Members
  const familyMembers = location.resident_family_members || [];
  truths.residentFamilyCount = familyMembers.length;

  const familyWithoutAvatars = familyMembers.filter(fm => !fm.name || fm.name.trim() === '');
  if (familyWithoutAvatars.length > 0) {
    issues.push(`FAMILY_MEMBERS_INVALID: ${familyWithoutAvatars.length}`);
  }

  // TRUTH: Zone Images
  const zones = location.zones || [];
  const zonesWithoutImages = zones.filter(z => !z.image_urls || z.image_urls.length === 0);
  
  truths.zoneCount = zones.length;
  truths.zonesWithImages = zones.length - zonesWithoutImages.length;

  if (zonesWithoutImages.length > 0) {
    issues.push(`ZONES_WITHOUT_IMAGES: ${zonesWithoutImages.map(z => z.zone_name).join(', ')}`);
  }

  return {
    locationId: location.id,
    locationName: location.name,
    truths,
    issues,
    isHealthy: issues.length === 0,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`REGRESSION AUDIT — Shared Truth Layer Diagnostic`);
    console.log(`User: ${user.email}`);
    console.log(`Date: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);

    // AUDIT 1: Character State Resolution
    console.log(`\n📋 AUDITING CHARACTER TRUTH STATE`);
    console.log(`${'─'.repeat(80)}`);

    const allCharacters = await base44.entities.Character.filter({ created_by: user.email });
    const activeCharacters = allCharacters.filter(c => c.status === 'active' && !c.is_test_character && !c.diagnostic_only);

    const characterAudits = [];
    for (const char of activeCharacters) {
      const audit = await auditCharacterTruthState(base44, char);
      characterAudits.push(audit);

      const statusIcon = audit.isHealthy ? '✅' : '⚠️';
      console.log(`${statusIcon} ${audit.characterName} (${audit.characterType})`);
      if (audit.issues.length > 0) {
        audit.issues.forEach(issue => console.log(`   └─ ${issue}`));
      }
      console.log(`   Location: ${audit.truths.presentLocation || 'UNSET'}`);
      if (audit.truths.internalFamilyCount) {
        console.log(`   Internal Family: ${audit.truths.internalFamilyCount}`);
      }
    }

    // AUDIT 2: Location State Resolution
    console.log(`\n📍 AUDITING LOCATION TRUTH STATE`);
    console.log(`${'─'.repeat(80)}`);

    const allLocations = await base44.entities.LocationReference.filter({ created_by: user.email });
    const locationAudits = [];

    for (const loc of allLocations) {
      const audit = await auditLocationTruthState(base44, loc);
      locationAudits.push(audit);

      const statusIcon = audit.isHealthy ? '✅' : '⚠️';
      console.log(`${statusIcon} ${audit.locationName}`);
      if (audit.issues.length > 0) {
        audit.issues.forEach(issue => console.log(`   └─ ${issue}`));
      }
      console.log(`   Residents: ${audit.truths.residentCharIds.length}, Family: ${audit.truths.residentFamilyCount}, Zones: ${audit.truths.zoneCount}`);
    }

    // SUMMARY
    const healthyChars = characterAudits.filter(a => a.isHealthy).length;
    const issueChars = characterAudits.filter(a => !a.isHealthy).length;
    const healthyLocs = locationAudits.filter(a => a.isHealthy).length;
    const issueLocs = locationAudits.filter(a => !a.isHealthy).length;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`AUDIT SUMMARY`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Characters: ${healthyChars}✅ / ${issueChars}⚠️`);
    console.log(`Locations: ${healthyLocs}✅ / ${issueLocs}⚠️`);

    const allIssues = characterAudits.concat(locationAudits).filter(a => !a.isHealthy);
    if (allIssues.length > 0) {
      console.log(`\nCRITICAL ISSUES DETECTED: ${allIssues.length}`);
      const issueCounts = {};
      allIssues.forEach(a => {
        a.issues.forEach(issue => {
          issueCounts[issue] = (issueCounts[issue] || 0) + 1;
        });
      });
      Object.entries(issueCounts).forEach(([issue, count]) => {
        console.log(`  • ${issue}: ${count} instances`);
      });
    }

    return Response.json({
      status: 'complete',
      user: user.email,
      characterAudits,
      locationAudits,
      summary: {
        totalCharacters: activeCharacters.length,
        healthyCharacters: healthyChars,
        issueCharacters: issueChars,
        totalLocations: allLocations.length,
        healthyLocations: healthyLocs,
        issueLocations: issueLocs,
      },
    });
  } catch (error) {
    console.error('Audit failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});