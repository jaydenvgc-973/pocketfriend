import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * DIAGNOSTIC: Matt Lopez Home Location Collapse
 * 
 * Identifies all characters incorrectly assigned to Matt Lopez's home,
 * traces the root cause, and reports the location resolution failure.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email },
      "-updated_date"
    );
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Find Matt Lopez
    const mattLopez = characters.find(c => 
      c.name?.toLowerCase().includes('matt') && c.name?.toLowerCase().includes('lopez')
    );
    
    if (!mattLopez) {
      return Response.json({
        status: 'MATT_LOPEZ_NOT_FOUND',
        message: 'Matt Lopez character not found in system'
      });
    }

    // Find Matt Lopez's home
    const mattHome = locationMap[mattLopez.current_home_location_id];
    if (!mattHome) {
      return Response.json({
        status: 'MATT_HOME_NOT_FOUND',
        mattLopezId: mattLopez.id,
        homeLocationId: mattLopez.current_home_location_id
      });
    }

    const report = {
      mattLopezId: mattLopez.id,
      mattLopezName: mattLopez.name,
      mattHomeId: mattHome.id,
      mattHomeName: mattHome.name,
      incorrectlyAssignedCharacters: [],
      validResidents: [],
      failureAnalysis: {
        defaultLocationFallback: false,
        brokenBusyMapping: false,
        staleOccupancy: false,
        badHomeReferenceReuse: false,
        failedScheduleFallback: false,
        visitStateLeak: false
      },
      rootCause: null
    };

    // Identify characters at Matt's home
    const charactersAtMattHome = characters.filter(c => 
      (c.current_location_id === mattHome.id || c.current_home_location_id === mattHome.id) &&
      c.id !== mattLopez.id
    );

    for (const char of charactersAtMattHome) {
      const traceData = {
        characterId: char.id,
        characterName: char.name,
        currentLocationId: char.current_location_id,
        currentLocationName: char.current_location_id ? locationMap[char.current_location_id]?.name : null,
        homeLocationId: char.current_home_location_id,
        homeLocationName: char.current_home_location_id ? locationMap[char.current_home_location_id]?.name : null,
        age: char.age,
        characterType: char.character_type,
        schedule: {
          workStart: char.work_start_time,
          workEnd: char.work_end_time,
          workDays: char.work_days,
          workLocationId: char.occupation_location_id,
          workLocationName: char.occupation_location_name
        },
        currentActivity: char.current_activity,
        status: char.status,
        isSitter: char.is_sitter,
        familyTies: char.family_members?.map(m => m.name) || [],
        isValidResident: false,
        failureReason: null
      };

      // Check if this character should actually be at Matt's home
      const isActualResident = mattHome.resident_character_ids?.includes(char.id);
      const isFamily = mattHome.resident_family_members?.some(m => 
        m.name.toLowerCase() === char.name.toLowerCase()
      );
      const isMattLopezRelative = mattLopez.family_members?.some(m => 
        m.name.toLowerCase() === char.name.toLowerCase()
      );
      const isSitterForHome = char.is_sitter && char.sitter_assigned_to_location_id === mattHome.id;

      if (isActualResident || isFamily || isMattLopezRelative || isSitterForHome) {
        traceData.isValidResident = true;
        report.validResidents.push(traceData);
      } else {
        // This character should NOT be at Matt's home
        traceData.isValidResident = false;

        // Determine failure reason
        if (!char.current_home_location_id) {
          traceData.failureReason = 'DEFAULT_LOCATION_FALLBACK: No home assigned, defaulted to Matt home';
          report.failureAnalysis.defaultLocationFallback = true;
        } else if (char.current_home_location_id !== mattHome.id && char.current_location_id === mattHome.id) {
          traceData.failureReason = 'BUSY_MAPPING_FAILURE: Busy status routed to wrong home';
          report.failureAnalysis.brokenBusyMapping = true;
        } else if (!locations.find(l => l.id === char.current_location_id)) {
          traceData.failureReason = 'INVALID_LOCATION_ID: Location ID does not exist';
          report.failureAnalysis.defaultLocationFallback = true;
        } else if (char.current_location_id === mattHome.id && char.current_home_location_id && char.current_home_location_id !== mattHome.id) {
          traceData.failureReason = 'STALE_OCCUPANCY: Persisting from old state';
          report.failureAnalysis.staleOccupancy = true;
        }

        report.incorrectlyAssignedCharacters.push(traceData);
      }
    }

    // Determine root cause
    if (report.incorrectlyAssignedCharacters.length > 0) {
      const failureTypes = Object.entries(report.failureAnalysis)
        .filter(([_, value]) => value === true)
        .map(([key, _]) => key);

      if (failureTypes.includes('defaultLocationFallback')) {
        report.rootCause = 'MISSING_HOME_ASSIGNMENT_DEFAULTS_TO_MATT_HOME';
      } else if (failureTypes.includes('brokenBusyMapping')) {
        report.rootCause = 'BUSY_STATE_ROUTING_USES_WRONG_LOCATION_FALLBACK';
      } else if (failureTypes.includes('staleOccupancy')) {
        report.rootCause = 'OCCUPANCY_LIST_NOT_REBUILT_AFTER_CHARACTER_MOVEMENT';
      } else {
        report.rootCause = 'MULTIPLE_LOCATION_RESOLUTION_FAILURES';
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});