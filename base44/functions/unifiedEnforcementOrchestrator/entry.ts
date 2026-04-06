import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * UNIFIED ENFORCEMENT ORCHESTRATOR
 * 
 * Coordinates all enforcement layers:
 * Layer 1: Audit all 10 systems
 * Layer 2: Apply repairs (up to 5 cycles)
 * Layer 3: Enforce core loop (12-step validation per character)
 * Layer 4: Validate 10-system sync
 * Layer 5: Report system health
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orchestration = {
      timestamp: new Date().toISOString(),
      userId: user.email,
      mode: 'UNIFIED_ENFORCEMENT_ORCHESTRATION',
      layers: {},
      finalStatus: null,
      totalViolationsFixed: 0,
      systemHealthScore: 0
    };

    // ========== LAYER 1: AUDIT ==========
    console.log('[ORCHESTRATOR] Layer 1: Running system audit...');
    const auditResult = await base44.functions.invoke('masterSystemAudit', {});
    orchestration.layers['1_AUDIT'] = {
      status: 'complete',
      violationsFound: auditResult.data?.totalViolations || 0,
      systemsScanned: auditResult.data?.systemsAudited?.length || 10
    };

    // ========== LAYER 2: REPAIR ==========
    console.log('[ORCHESTRATOR] Layer 2: Applying auto-repairs...');
    const repairResult = await base44.functions.invoke('masterSystemRepair', {});
    orchestration.layers['2_REPAIR'] = {
      status: 'complete',
      cyclesRun: repairResult.data?.cycles || 0,
      fixesApplied: repairResult.data?.totalFixesApplied || 0,
      remainingViolations: repairResult.data?.remainingViolations || 0
    };

    orchestration.totalViolationsFixed += repairResult.data?.totalFixesApplied || 0;

    // ========== LAYER 3: CORE LOOP ENFORCEMENT ==========
    console.log('[ORCHESTRATOR] Layer 3: Enforcing core loop...');
    const coreLoopResult = await base44.functions.invoke('enforceCoreLoop', {});
    orchestration.layers['3_CORE_LOOP'] = {
      status: 'complete',
      charactersProcessed: coreLoopResult.data?.charactersProcessed || 0,
      correctionsApplied: coreLoopResult.data?.correctionsApplied || 0,
      violationsDetected: coreLoopResult.data?.violationsFound || 0
    };

    orchestration.totalViolationsFixed += coreLoopResult.data?.correctionsApplied || 0;

    // ========== LAYER 4: 10-SYSTEM SYNC VALIDATION ==========
    console.log('[ORCHESTRATOR] Layer 4: Validating 10-system sync...');
    const syncValidation = await validate10SystemSync(base44, user.email);
    orchestration.layers['4_10_SYSTEM_SYNC'] = syncValidation;

    // ========== LAYER 5: HEALTH REPORT ==========
    console.log('[ORCHESTRATOR] Layer 5: Generating health report...');
    const healthReport = await generateHealthReport(orchestration);
    orchestration.layers['5_HEALTH_REPORT'] = healthReport;
    orchestration.systemHealthScore = healthReport.healthScore;

    // ========== FINAL STATUS ==========
    orchestration.finalStatus = healthReport.overallStatus;

    return Response.json(orchestration);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});

/**
 * VALIDATE 10-SYSTEM SYNC
 * Ensures all 10 systems are in agreement
 */
async function validate10SystemSync(base44, userEmail) {
  const syncReport = {
    status: 'validating',
    systems: {},
    syncIssues: [],
    totalIssues: 0
  };

  try {
    const [characters, locations, relationships, conversations, messages, financials, schedules, conversations2, charMemory, charIdentity] = await Promise.all([
      base44.entities.Character.filter({ created_by: userEmail }, '-created_date', 200),
      base44.entities.LocationReference.list('-created_date', 300),
      base44.entities.CharacterRelationship.list('-created_date', 500),
      base44.entities.Conversation.list('-created_date', 500),
      base44.entities.Message.list('-created_date', 1000),
      base44.entities.CharacterFinancial.list('-created_date', 200),
      base44.entities.CharacterScheduleProfile.list('-created_date', 200),
      base44.entities.Message.list('-created_date', 500),
      base44.entities.CharacterMemory.list('-created_date', 500),
      base44.entities.CharacterIdentityReference.list('-created_date', 500)
    ]);

    const locationMap = new Map(locations.map(l => [l.id, l]));

    // SYSTEM 1: CHARACTER SYSTEM
    const char1 = characters.filter(c => !c.name || !c.emotional_state).length;
    syncReport.systems['1_CHARACTER'] = {
      total: characters.length,
      incomplete: char1,
      status: char1 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (char1 > 0) syncReport.syncIssues.push(`${char1} characters missing required fields`);

    // SYSTEM 2: CHARACTER TYPE
    const validTypes = new Set(['active', 'npc', 'family_npc', 'background', 'promoted_npc']);
    const char2 = characters.filter(c => !validTypes.has(c.character_type)).length;
    syncReport.systems['2_CHARACTER_TYPE'] = {
      total: characters.length,
      invalid: char2,
      status: char2 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (char2 > 0) syncReport.syncIssues.push(`${char2} characters with invalid types`);

    // SYSTEM 3: RELATIONSHIP
    const rel3 = relationships.filter(r => !characters.find(c => c.id === r.source_character_id) || !characters.find(c => c.id === r.target_character_id)).length;
    syncReport.systems['3_RELATIONSHIP'] = {
      total: relationships.length,
      orphaned: rel3,
      status: rel3 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (rel3 > 0) syncReport.syncIssues.push(`${rel3} relationships with missing characters`);

    // SYSTEM 4: LOCATION
    const loc4 = locations.filter(l => !l.name || !l.category).length;
    syncReport.systems['4_LOCATION'] = {
      total: locations.length,
      incomplete: loc4,
      status: loc4 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (loc4 > 0) syncReport.syncIssues.push(`${loc4} locations with missing metadata`);

    // SYSTEM 5: LOCATION VALIDATION
    let locVal5 = 0;
    for (const c of characters) {
      if ((c.current_location_id && !locationMap.has(c.current_location_id)) ||
          (c.current_home_location_id && !locationMap.has(c.current_home_location_id)) ||
          (c.current_work_location_id && !locationMap.has(c.current_work_location_id)) ||
          (c.current_school_location_id && !locationMap.has(c.current_school_location_id))) {
        locVal5++;
      }
    }
    syncReport.systems['5_LOCATION_VALIDATION'] = {
      totalCharacters: characters.length,
      invalidReferences: locVal5,
      status: locVal5 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (locVal5 > 0) syncReport.syncIssues.push(`${locVal5} characters with invalid location references`);

    // SYSTEM 6: HOURS OF OPERATION
    const now = new Date();
    const dayOfWeek = now.getDay();
    let hours6 = 0;
    for (const c of characters) {
      if (!c.current_location_id) continue;
      const loc = locationMap.get(c.current_location_id);
      if (loc?.operating_hours?.length > 0) {
        const todayHours = loc.operating_hours.find(h => h.day_of_week === dayOfWeek);
        if (todayHours) {
          const [openHour] = todayHours.open_time.split(':').map(Number);
          const [closeHour] = todayHours.close_time.split(':').map(Number);
          if (now.getHours() < openHour || now.getHours() >= closeHour) hours6++;
        }
      }
    }
    syncReport.systems['6_HOURS_OF_OPERATION'] = {
      charactersAtLocations: characters.filter(c => c.current_location_id).length,
      atClosedLocations: hours6,
      status: hours6 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (hours6 > 0) syncReport.syncIssues.push(`${hours6} characters at closed locations`);

    // SYSTEM 7: SCHEDULING
    let sched7 = 0;
    for (const c of characters) {
      if (c.work_start_time && c.work_end_time && c.work_days) {
        const [start] = c.work_start_time.split(':').map(Number);
        const [end] = c.work_end_time.split(':').map(Number);
        if (c.work_days.includes(dayOfWeek) && now.getHours() >= start && now.getHours() < end) {
          if (!c.current_work_location_id) sched7++;
        }
      }
    }
    syncReport.systems['7_SCHEDULING'] = {
      charactersOnSchedule: characters.filter(c => c.work_start_time && c.work_end_time).length,
      missingWorkLocation: sched7,
      status: sched7 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (sched7 > 0) syncReport.syncIssues.push(`${sched7} characters on schedule without work location`);

    // SYSTEM 8: PRESENCE
    let presence8 = 0;
    for (const c of characters) {
      const locs = [c.current_location_id, c.current_home_location_id, c.current_work_location_id, c.current_school_location_id].filter(l => l && l !== c.current_location_id).length;
      if (locs > 0) presence8++;
    }
    syncReport.systems['8_PRESENCE'] = {
      totalCharacters: characters.length,
      dualPresence: presence8,
      status: presence8 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (presence8 > 0) syncReport.syncIssues.push(`${presence8} characters in multiple locations`);

    // SYSTEM 9: TRAVEL
    let travel9 = 0;
    const charIds = new Set(characters.map(c => c.id));
    for (const conv of conversations) {
      if (conv.character_ids?.some(id => !charIds.has(id))) travel9++;
    }
    syncReport.systems['9_TRAVEL'] = {
      totalConversations: conversations.length,
      withInvalidCharacters: travel9,
      status: travel9 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (travel9 > 0) syncReport.syncIssues.push(`${travel9} conversations with invalid characters`);

    // SYSTEM 10: MESSAGE
    let msg10 = 0;
    for (const m of messages) {
      if (!m.conversation_id || !m.sender_type || !m.content) msg10++;
    }
    syncReport.systems['10_MESSAGE'] = {
      totalMessages: messages.length,
      incomplete: msg10,
      status: msg10 === 0 ? '✓ SYNC' : '⚠ ISSUES'
    };
    if (msg10 > 0) syncReport.syncIssues.push(`${msg10} messages with missing fields`);

    syncReport.totalIssues = syncReport.syncIssues.length;
    syncReport.status = syncReport.totalIssues === 0 ? '✓ ALL SYSTEMS SYNCHRONIZED' : `⚠ ${syncReport.totalIssues} SYNC ISSUES`;

  } catch (error) {
    syncReport.status = `ERROR: ${error.message}`;
  }

  return syncReport;
}

/**
 * GENERATE HEALTH REPORT
 * Overall system health assessment
 */
function generateHealthReport(orchestration) {
  const layers = orchestration.layers;
  
  const audit = layers['1_AUDIT'];
  const repair = layers['2_REPAIR'];
  const coreLoop = layers['3_CORE_LOOP'];
  const sync = layers['4_10_SYSTEM_SYNC'];

  const auditViolations = audit?.violationsFound || 0;
  const remainingViolations = repair?.remainingViolations || 0;
  const coreLoopViolations = coreLoop?.violationsDetected || 0;
  const syncIssues = sync?.totalIssues || 0;

  const totalIssues = remainingViolations + coreLoopViolations + syncIssues;
  const healthScore = Math.max(0, 100 - (totalIssues * 10));

  let overallStatus;
  if (healthScore === 100) {
    overallStatus = '✓✓✓ PERFECT: All systems compliant and synchronized';
  } else if (healthScore >= 90) {
    overallStatus = '✓✓ HEALTHY: Minor issues detected and repairing';
  } else if (healthScore >= 70) {
    overallStatus = '✓ OPERATIONAL: Moderate issues present, repairs in progress';
  } else {
    overallStatus = '⚠ CAUTION: Significant issues, enforcement ongoing';
  }

  return {
    healthScore,
    overallStatus,
    auditSummary: {
      initialViolations: auditViolations,
      afterRepair: remainingViolations,
      repairsApplied: auditViolations - remainingViolations
    },
    enforcementSummary: {
      coreLoopViolations,
      syncIssues,
      totalUnresolvedIssues: totalIssues
    },
    recommendation: totalIssues === 0 
      ? 'System is fully compliant. Continue monitoring.' 
      : `${totalIssues} issue(s) detected. Re-run enforcement cycle.`
  };
}