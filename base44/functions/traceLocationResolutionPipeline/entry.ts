import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * TRACE: Location Resolution Pipeline
 * 
 * For EVERY character, shows:
 * 1. Current location data (ID, name, source)
 * 2. Home location data
 * 3. Work schedule state
 * 4. What card reads
 * 5. What Travel reads
 * 6. Discrepancies
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      "-updated_date"
    );

    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const trace = {
      totalCharacters: characters.length,
      characters: [],
      discrepancies: []
    };

    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    for (const char of characters) {
      // Get all location references
      const currentLoc = char.current_location_id ? locationMap[char.current_location_id] : null;
      const homeLoc = char.current_home_location_id ? locationMap[char.current_home_location_id] : null;
      const workLoc = char.occupation_location_id ? locationMap[char.occupation_location_id] : null;
      const eduLoc = char.education_location_id ? locationMap[char.education_location_id] : null;

      // Check work schedule
      const hasWorkSchedule = char.work_start_time && char.work_end_time && char.work_days;
      const workStart = hasWorkSchedule ? parseInt(char.work_start_time.split(':')[0]) : null;
      const workEnd = hasWorkSchedule ? parseInt(char.work_end_time.split(':')[0]) : null;
      const isWorkDay = hasWorkSchedule && char.work_days.includes(dayOfWeek);
      const isWorkHours = hasWorkSchedule && isWorkDay && (currentHour >= workStart && currentHour < workEnd);

      // AUTHORITATIVE RESOLUTION — matches lib/authoritativeLocationResolver.js logic
      let authoritativeLoc = null;
      let authoritativeSource = null;

      // 1. Work schedule takes priority
      if (isWorkHours && workLoc) {
        authoritativeLoc = workLoc;
        authoritativeSource = 'active_work_schedule';
      } 
      // 2. School enrollment
      else if (char.student_status === 'enrolled' && eduLoc) {
        authoritativeLoc = eduLoc;
        authoritativeSource = 'active_school_schedule';
      }
      // 3. Explicit current location (but NOT if it equals home)
      else if (currentLoc && char.current_location_id !== char.current_home_location_id) {
        authoritativeLoc = currentLoc;
        authoritativeSource = 'explicit_current_location';
      }
      // 4. Home fallback (only if no schedule/travel)
      else if (homeLoc) {
        authoritativeLoc = homeLoc;
        authoritativeSource = 'home_fallback_no_obligation';
      }

      // What Card SHOULD read (authoritative resolver)
      const cardReadSource = authoritativeSource;
      const cardReadLocation = authoritativeLoc;

      // What Travel ACTUALLY reads (from current_location_id in grid)
      const travelReadLocation = currentLoc;
      const travelReadSource = currentLoc ? 'explicit_current_location' : null;

      // Detect discrepancy
      const cardShowsHome = cardReadSource === 'home_fallback';
      const travelShowsWork = travelReadLocation?.id === char.occupation_location_id;
      const hasDiscrepancy = cardShowsHome && travelShowsWork;

      const charTrace = {
        characterId: char.id,
        characterName: char.name,
        currentLocationId: char.current_location_id,
        currentLocationName: currentLoc?.name || null,
        homeLocationId: char.current_home_location_id,
        homeLocationName: homeLoc?.name || null,
        workLocationId: char.occupation_location_id,
        workLocationName: workLoc?.name || null,
        workSchedule: hasWorkSchedule ? `${char.work_start_time}-${char.work_end_time}` : 'none',
        isWorkScheduleActive: isWorkHours,
        workDays: char.work_days || [],
        authoritative: {
          locationId: authoritativeLoc?.id || null,
          locationName: authoritativeLoc?.name || null,
          source: authoritativeSource
        },
        cardReads: {
          locationId: cardReadLocation?.id || null,
          locationName: cardReadLocation?.name || null,
          source: cardReadSource
        },
        travelReads: {
          locationId: travelReadLocation?.id || null,
          locationName: travelReadLocation?.name || null,
          source: travelReadSource || 'none'
        },
        discrepancy: hasDiscrepancy ? {
          type: 'HOME_OVERRIDE_DURING_WORK',
          cardShows: cardReadLocation?.name || 'Home',
          travelShows: travelReadLocation?.name || 'Unknown',
          message: `Card forced to home while Travel shows work location`
        } : null
      };

      trace.characters.push(charTrace);

      if (hasDiscrepancy) {
        trace.discrepancies.push({
          characterId: char.id,
          characterName: char.name,
          type: 'HOME_OVERRIDE_DURING_WORK',
          cardShows: cardReadLocation?.name || 'Home',
          travelShows: travelReadLocation?.name || 'Unknown',
          workLocationName: workLoc?.name || 'Unknown',
          workSchedule: `${char.work_start_time}-${char.work_end_time}`,
          severity: 'CRITICAL'
        });
      }
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      trace,
      summary: {
        totalCharacters: trace.totalCharacters,
        discrepancies: trace.discrepancies.length,
        homeOverrideIssues: trace.discrepancies.filter(d => d.type === 'HOME_OVERRIDE_DURING_WORK').length
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});