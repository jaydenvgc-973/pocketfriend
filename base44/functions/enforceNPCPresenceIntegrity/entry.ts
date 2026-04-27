import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── CURRENT TIME & WINDOW DETERMINATION ──────────────────────────────────
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const dayOfWeek = nowET.getDay();

    // Travel window = 6 AM to 11 PM (waking hours, excludes sleep 11 PM - 6 AM)
    const isInTravelWindow = hour >= 6 && hour < 23;
    
    // Sleep window = 11 PM to 6 AM
    const isInSleepWindow = hour >= 23 || hour < 6;

    // ── FETCH CORE DATA ──────────────────────────────────────────────────────
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      200
    );
    
    const npcs = characters.filter(c => c.character_type === 'npc' || c.character_type === 'promoted_npc');
    const locations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email },
      '-created_date',
      100
    );

    // ── DIAGNOSTIC PASS: IDENTIFY FAILURES ────────────────────────────────────
    const issues = [];
    const npcReport = [];

    for (const npc of npcs) {
      const issue = {
        npc_id: npc.id,
        npc_name: npc.name,
        violations: [],
      };

      // Check 1: Location validity
      const currentLocId = npc.resolved_current_location_id || npc.current_home_location_id;
      if (!currentLocId) {
        issue.violations.push('NO_LOCATION_ASSIGNED');
      } else {
        const locExists = locations.find(l => l.id === currentLocId);
        if (!locExists) {
          issue.violations.push('INVALID_LOCATION_ID');
        }
      }

      // Check 2: Unknown location string
      if (npc.resolved_current_location_name === 'Unknown' || !npc.resolved_current_location_name) {
        issue.violations.push('UNKNOWN_LOCATION_NAME');
      }

      // Check 3: Sleep/travel conflict
      if (isInTravelWindow && (npc.resolved_presence_status === 'sleeping' || npc.resolved_presence_status === 'napping')) {
        issue.violations.push('SLEEP_DURING_TRAVEL_WINDOW');
      }

      // Check 4: Stuck at home during travel
      if (isInTravelWindow && npc.current_home_location_id === currentLocId && npc.resolved_presence_status === 'home') {
        const homeLocation = locations.find(l => l.id === npc.current_home_location_id);
        if (homeLocation?.name === 'VGC Towers') {
          // This is OK if the NPC doesn't have a work/school location
          // But flag if they should be somewhere else
          if (!npc.resolved_current_location_id || npc.resolved_current_location_id === npc.current_home_location_id) {
            // Mild flag: NPC at home during travel window
            // issue.violations.push('AT_HOME_DURING_TRAVEL_WINDOW');
          }
        }
      }

      npcReport.push({
        id: npc.id,
        name: npc.name,
        current_location_id: currentLocId,
        current_location_name: npc.resolved_current_location_name,
        presence_status: npc.resolved_presence_status,
        work_location_id: npc.occupation_location_id,
        home_location_id: npc.current_home_location_id,
      });

      if (issue.violations.length > 0) {
        issues.push(issue);
      }
    }

    // ── REPAIR PASS: FIX VIOLATIONS ──────────────────────────────────────────
    const repairs = [];

    for (const issue of issues) {
      const npc = npcs.find(n => n.id === issue.npc_id);
      if (!npc) continue;

      let targetLocationId = null;
      let targetLocationName = null;
      const repairActions = [];

      // Priority 1: If has valid work location and work schedule is active now
      if (npc.occupation_location_id && npc.work_start_time && npc.work_end_time && npc.work_days) {
        const dayOfWeek = nowET.getDay();
        if (npc.work_days.includes(dayOfWeek)) {
          const [wsh, wsm] = npc.work_start_time.split(':').map(Number);
          const [weh, wem] = npc.work_end_time.split(':').map(Number);
          const now = nowET.getHours() * 60 + nowET.getMinutes();
          const startMin = wsh * 60 + wsm;
          const endMin = weh * 60 + wem;
          const isNowInShift = (endMin < startMin) ? (now >= startMin || now < endMin) : (now >= startMin && now < endMin);
          
          if (isNowInShift) {
            const workLoc = locations.find(l => l.id === npc.occupation_location_id);
            if (workLoc) {
              targetLocationId = workLoc.id;
              targetLocationName = workLoc.name;
              repairActions.push('ASSIGNED_TO_WORK_LOCATION');
            }
          }
        }
      }

      // Priority 2: If has valid home location and during sleep window
      if (!targetLocationId && isInSleepWindow && npc.current_home_location_id) {
        const homeLoc = locations.find(l => l.id === npc.current_home_location_id);
        if (homeLoc) {
          targetLocationId = homeLoc.id;
          targetLocationName = homeLoc.name;
          repairActions.push('ASSIGNED_TO_HOME_FOR_SLEEP');
        }
      }

      // Priority 3: Default to home location
      if (!targetLocationId && npc.current_home_location_id) {
        const homeLoc = locations.find(l => l.id === npc.current_home_location_id);
        if (homeLoc) {
          targetLocationId = homeLoc.id;
          targetLocationName = homeLoc.name;
          repairActions.push('ASSIGNED_TO_HOME_DEFAULT');
        }
      }

      // Priority 4: Assign to any public location (cafe, park, etc.)
      if (!targetLocationId && isInTravelWindow) {
        const publicLoc = locations.find(l => 
          l.category && 
          ['social', 'food_drink', 'outdoor', 'medical', 'education'].includes(l.category)
        );
        if (publicLoc) {
          targetLocationId = publicLoc.id;
          targetLocationName = publicLoc.name;
          repairActions.push('ASSIGNED_TO_PUBLIC_LOCATION');
        }
      }

      // If still no location, use first available
      if (!targetLocationId && locations.length > 0) {
        targetLocationId = locations[0].id;
        targetLocationName = locations[0].name;
        repairActions.push('ASSIGNED_TO_FIRST_AVAILABLE');
      }

      // Apply repair
      if (targetLocationId) {
        // Determine correct status and type based on assignment
        let presenceStatus = 'home';
        let locationType = 'home';
        if (repairActions.includes('ASSIGNED_TO_WORK_LOCATION')) {
          presenceStatus = 'at_work';
          locationType = 'work';
        } else if (isInSleepWindow) {
          presenceStatus = 'sleeping';
          locationType = 'home';
        }
        
        await base44.asServiceRole.entities.Character.update(npc.id, {
          resolved_current_location_id: targetLocationId,
          resolved_current_location_name: targetLocationName,
          resolved_presence_status: presenceStatus,
          resolved_location_type: locationType,
        });

        repairs.push({
          npc_id: npc.id,
          npc_name: npc.name,
          from: npc.resolved_current_location_name,
          to: targetLocationName,
          actions: repairActions,
        });
      }
    }

    return Response.json({
      success: true,
      timestamp: nowET.toISOString(),
      is_in_travel_window: isInTravelWindow,
      is_in_sleep_window: isInSleepWindow,
      total_npcs: npcs.length,
      violations_found: issues.length,
      violations: issues,
      repairs_applied: repairs.length,
      repairs,
      npc_state_summary: npcReport,
    });
  } catch (error) {
    console.error('[enforceNPCPresenceIntegrity]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});