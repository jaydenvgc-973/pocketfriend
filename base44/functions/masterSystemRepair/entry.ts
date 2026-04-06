import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repairLog = {
      timestamp: new Date().toISOString(),
      userId: user.email,
      mode: 'STRICT_DIAGNOSTIC + AUTO_REPAIR',
      cycles: 0,
      maxCycles: 5,
      totalFixesApplied: 0,
      fixBySystem: {},
      remainingViolations: 0,
      finalStatus: null
    };

    // CONTINUOUS REPAIR LOOP — repeat until zero violations
    let violationCount = 1;
    while (violationCount > 0 && repairLog.cycles < repairLog.maxCycles) {
      repairLog.cycles++;
      const cycleLog = { cycle: repairLog.cycles, fixesThisCycle: 0, systems: {} };

      // FETCH FRESH DATA EACH CYCLE
      const [characters, locations, relationships, conversations, messages, financials] = await Promise.all([
        base44.entities.Character.filter({ created_by: user.email }, '-created_date', 200),
        base44.entities.LocationReference.list('-created_date', 300),
        base44.entities.CharacterRelationship.list('-created_date', 500),
        base44.entities.Conversation.list('-created_date', 500),
        base44.entities.Message.list('-created_date', 1000),
        base44.entities.CharacterFinancial.list('-created_date', 200)
      ]);

      const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
      const now = new Date();
      const currentHour = now.getHours();
      const dayOfWeek = now.getDay();

      // ========== SYSTEM 1: CHARACTER SYSTEM ==========
      const system1Fixes = [];
      for (const char of characters) {
        if (char.status === 'active' && char.character_type !== 'npc' && char.character_type !== 'background') {
          const updates = {};
          
          // Add missing emotional_state
          if (!char.emotional_state) {
            updates.emotional_state = 'calm';
            system1Fixes.push(`${char.name}: added emotional_state`);
          }
          
          // Add missing wake/sleep times
          if (!char.wake_time) {
            updates.wake_time = '07:00';
          }
          if (!char.sleep_time) {
            updates.sleep_time = '23:00';
          }
          
          if (Object.keys(updates).length > 0) {
            await base44.entities.Character.update(char.id, updates);
            cycleLog.fixesThisCycle += Object.keys(updates).length;
            repairLog.totalFixesApplied += Object.keys(updates).length;
          }
        }
      }
      if (system1Fixes.length > 0) cycleLog.systems['1_CHARACTER_SYSTEM'] = system1Fixes;

      // ========== SYSTEM 2: CHARACTER TYPE SYSTEM ==========
      const system2Fixes = [];
      for (const char of characters) {
        // Normalize character_type to valid values
        const validTypes = ['active', 'npc', 'family_npc', 'background', 'promoted_npc'];
        if (char.character_type && !validTypes.includes(char.character_type)) {
          // Default to 'npc' if invalid
          await base44.entities.Character.update(char.id, { character_type: 'npc' });
          system2Fixes.push(`${char.name}: corrected invalid type to 'npc'`);
          cycleLog.fixesThisCycle++;
          repairLog.totalFixesApplied++;
        }
      }
      if (system2Fixes.length > 0) cycleLog.systems['2_CHARACTER_TYPE_SYSTEM'] = system2Fixes;

      // ========== SYSTEM 3: RELATIONSHIP SYSTEM ==========
      const system3Fixes = [];
      // Remove relationships with missing characters
      const validCharIds = new Set(characters.map(c => c.id));
      const relToDelete = relationships.filter(r => !validCharIds.has(r.source_character_id) || !validCharIds.has(r.target_character_id));
      for (const rel of relToDelete) {
        await base44.entities.CharacterRelationship.delete(rel.id);
        system3Fixes.push(`Deleted broken relationship ${rel.id}`);
        cycleLog.fixesThisCycle++;
        repairLog.totalFixesApplied++;
      }
      if (system3Fixes.length > 0) cycleLog.systems['3_RELATIONSHIP_SYSTEM'] = system3Fixes;

      // ========== SYSTEM 4: LOCATION SYSTEM ==========
      const system4Fixes = [];
      for (const loc of locations) {
        const updates = {};
        if (!loc.name) {
          updates.name = `Location ${loc.id.substring(0, 8)}`;
          system4Fixes.push(`${loc.id}: added default name`);
        }
        if (!loc.location_type) {
          updates.location_type = 'global';
          system4Fixes.push(`${loc.name}: added location_type`);
        }
        if (!loc.category) {
          updates.category = 'generic';
          system4Fixes.push(`${loc.name}: added category`);
        }
        if (Object.keys(updates).length > 0) {
          await base44.entities.LocationReference.update(loc.id, updates);
          cycleLog.fixesThisCycle += Object.keys(updates).length;
          repairLog.totalFixesApplied += Object.keys(updates).length;
        }
      }
      if (system4Fixes.length > 0) cycleLog.systems['4_LOCATION_SYSTEM'] = system4Fixes;

      // ========== SYSTEM 5: LOCATION VALIDATION SYSTEM ==========
      const system5Fixes = [];
      for (const char of characters) {
        const updates = {};
        
        // Validate and clear invalid location references
        if (char.current_location_id && !locationMap[char.current_location_id]) {
          updates.current_location_id = null;
          system5Fixes.push(`${char.name}: cleared invalid current_location_id`);
        }
        if (char.current_home_location_id && !locationMap[char.current_home_location_id]) {
          updates.current_home_location_id = null;
          system5Fixes.push(`${char.name}: cleared invalid current_home_location_id`);
        }
        if (char.current_work_location_id && !locationMap[char.current_work_location_id]) {
          updates.current_work_location_id = null;
          system5Fixes.push(`${char.name}: cleared invalid current_work_location_id`);
        }
        if (char.current_school_location_id && !locationMap[char.current_school_location_id]) {
          updates.current_school_location_id = null;
          system5Fixes.push(`${char.name}: cleared invalid current_school_location_id`);
        }
        
        if (Object.keys(updates).length > 0) {
          await base44.entities.Character.update(char.id, updates);
          cycleLog.fixesThisCycle += Object.keys(updates).length;
          repairLog.totalFixesApplied += Object.keys(updates).length;
        }
      }
      if (system5Fixes.length > 0) cycleLog.systems['5_LOCATION_VALIDATION_SYSTEM'] = system5Fixes;

      // ========== SYSTEM 6: HOURS OF OPERATION SYSTEM ==========
      const system6Fixes = [];
      for (const char of characters) {
        if (!char.current_location_id) continue;
        
        const loc = locationMap[char.current_location_id];
        if (!loc || !loc.operating_hours || loc.operating_hours.length === 0) continue;
        
        const todayHours = loc.operating_hours.find(h => h.day_of_week === dayOfWeek);
        if (!todayHours) continue;
        
        const [openHour] = todayHours.open_time.split(':').map(Number);
        const [closeHour] = todayHours.close_time.split(':').map(Number);
        
        // If at closed location, move to home
        if (currentHour < openHour || currentHour >= closeHour) {
          if (char.current_home_location_id) {
            await base44.entities.Character.update(char.id, { 
              current_location_id: char.current_home_location_id,
              current_activity: `Returned home (${loc.name} closed)`
            });
            system6Fixes.push(`${char.name}: moved to home (${loc.name} closed at ${todayHours.close_time})`);
            cycleLog.fixesThisCycle++;
            repairLog.totalFixesApplied++;
          }
        }
      }
      if (system6Fixes.length > 0) cycleLog.systems['6_HOURS_OF_OPERATION_SYSTEM'] = system6Fixes;

      // ========== SYSTEM 7: SCHEDULING SYSTEM ==========
      const system7Fixes = [];
      for (const char of characters) {
        if (char.work_start_time && char.work_end_time && char.work_days) {
          const [workStart] = char.work_start_time.split(':').map(Number);
          const [workEnd] = char.work_end_time.split(':').map(Number);
          const isWorkDay = char.work_days.includes(dayOfWeek);
          const isWorkHours = currentHour >= workStart && currentHour < workEnd;
          
          // If on work schedule, ensure work_location_id is set
          if (isWorkDay && isWorkHours && !char.current_work_location_id) {
            // Try to use current_location_id or assign a work location
            if (char.current_location_id && locationMap[char.current_location_id]?.category === 'work') {
              await base44.entities.Character.update(char.id, { 
                current_work_location_id: char.current_location_id 
              });
              system7Fixes.push(`${char.name}: assigned work_location from current_location`);
              cycleLog.fixesThisCycle++;
              repairLog.totalFixesApplied++;
            }
          }
        }
        
        // If enrolled student, ensure school_location_id is set
        if (char.student_status === 'enrolled' && !char.current_school_location_id) {
          const schoolLoc = locations.find(l => l.category === 'school' || l.category === 'education');
          if (schoolLoc) {
            await base44.entities.Character.update(char.id, { 
              current_school_location_id: schoolLoc.id 
            });
            system7Fixes.push(`${char.name}: assigned school_location`);
            cycleLog.fixesThisCycle++;
            repairLog.totalFixesApplied++;
          }
        }
      }
      if (system7Fixes.length > 0) cycleLog.systems['7_SCHEDULING_SYSTEM'] = system7Fixes;

      // ========== SYSTEM 8: PRESENCE SYSTEM ==========
      const system8Fixes = [];
      for (const char of characters) {
        // Ensure character is never in two places at once
        const locs = [];
        if (char.current_location_id) locs.push(char.current_location_id);
        if (char.current_home_location_id && char.current_location_id !== char.current_home_location_id) locs.push(char.current_home_location_id);
        
        if (locs.length > 1) {
          // Keep current_location_id as authoritative, remove home
          await base44.entities.Character.update(char.id, {
            current_home_location_id: null
          });
          system8Fixes.push(`${char.name}: resolved dual presence (kept current_location)`);
          cycleLog.fixesThisCycle++;
          repairLog.totalFixesApplied++;
        }
      }
      if (system8Fixes.length > 0) cycleLog.systems['8_PRESENCE_SYSTEM'] = system8Fixes;

      // ========== SYSTEM 9: TRAVEL SYSTEM ==========
      const system9Fixes = [];
      for (const conv of conversations) {
        if (!conv.character_ids) continue;
        
        // Validate all character_ids exist
        const invalidIds = conv.character_ids.filter(id => !validCharIds.has(id));
        if (invalidIds.length > 0) {
          const validIds = conv.character_ids.filter(id => validCharIds.has(id));
          if (validIds.length > 0) {
            await base44.entities.Conversation.update(conv.id, { 
              character_ids: validIds 
            });
            system9Fixes.push(`Conversation ${conv.id}: removed ${invalidIds.length} invalid character(s)`);
            cycleLog.fixesThisCycle++;
            repairLog.totalFixesApplied++;
          }
        }
      }
      if (system9Fixes.length > 0) cycleLog.systems['9_TRAVEL_SYSTEM'] = system9Fixes;

      // ========== SYSTEM 10: MESSAGE SYSTEM ==========
      const system10Fixes = [];
      // Check for messages with missing critical fields
      const msgsToFix = messages.filter(m => !m.conversation_id || !m.sender_type);
      if (msgsToFix.length > 0) {
        system10Fixes.push(`Found ${msgsToFix.length} messages with missing fields`);
        // Note: These would need manual review; we flag but don't auto-delete
        cycleLog.fixesThisCycle += msgsToFix.length;
      }
      if (system10Fixes.length > 0) cycleLog.systems['10_MESSAGE_SYSTEM'] = system10Fixes;

      // RE-RUN AUDIT TO CHECK REMAINING VIOLATIONS
      const auditResponse = await base44.functions.invoke('masterSystemAudit', {});
      violationCount = auditResponse.data?.totalViolations || 0;

      repairLog.cycles = cycleLog.cycle;
      repairLog.cycleLog = cycleLog;
      repairLog.remainingViolations = violationCount;
    }

    repairLog.finalStatus = repairLog.remainingViolations === 0 
      ? `✓ REPAIR COMPLETE: All violations fixed in ${repairLog.cycles} cycles. Total fixes: ${repairLog.totalFixesApplied}`
      : `⚠ REPAIR INCOMPLETE: ${repairLog.remainingViolations} violations remain after ${repairLog.cycles} cycles`;

    return Response.json(repairLog);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});