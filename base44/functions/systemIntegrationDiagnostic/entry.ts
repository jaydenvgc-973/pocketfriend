import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * System Integration Diagnostic
 * Checks for: sync issues, feature isolation, state mismatches, memory sharing
 * Validates: cross-system awareness, event propagation, UI consistency
 */

const ISSUE_CODES = {
  SYSTEM_DESYNC: 'Systems are out of sync',
  EVENT_NOT_PROPAGATED: 'Event did not ripple across systems',
  FEATURE_ISOLATION: 'Feature operating independently',
  UI_STATE_MISMATCH: 'UI views show different state',
  MEMORY_NOT_SHARED: 'Memory exists but not used by systems',
  LOGIC_CONFLICT: 'Systems have conflicting logic',
  CHARACTER_INCONSISTENCY: 'Character behavior inconsistent',
  STATE_UPDATE_DELAY: 'State updates not immediate',
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const { characterId } = await req.json();

  try {
    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (!character[0]) return Response.json({ error: 'Character not found' }, { status: 404 });

    const char = character[0];
    const issues = [];
    const checks = {};

    // ─── CHECK 1: ARE SYSTEMS UPDATING TOGETHER ───
    checks.location_sync = {
      status: 'pass',
      details: [],
    };

    // Character card location should match travel page
    if (char.resolved_current_location_id && char.resolved_presence_status) {
      if (char.resolved_current_location_id === char.current_work_location_id && char.resolved_presence_status !== 'at_work') {
        issues.push({
          code: 'SYSTEM_DESYNC',
          severity: 'high',
          message: `Location is work but presence status is ${char.resolved_presence_status}`,
          affects: ['character_card', 'travel_page', 'chat'],
        });
        checks.location_sync.status = 'fail';
      }
    }

    // ─── CHECK 2: IS ANY SYSTEM USING STALE DATA ───
    checks.data_freshness = { status: 'pass', details: [] };

    if (char.resolved_last_updated_at) {
      const hoursSinceUpdate = (Date.now() - new Date(char.resolved_last_updated_at).getTime()) / (1000 * 3600);
      if (hoursSinceUpdate > 2) {
        issues.push({
          code: 'STATE_UPDATE_DELAY',
          severity: 'medium',
          message: `Location data is ${Math.floor(hoursSinceUpdate)} hours stale`,
          affects: ['location', 'travel_page', 'character_card'],
        });
        checks.data_freshness.status = 'warning';
      }
    }

    // ─── CHECK 3: ARE EVENTS PROPAGATING CORRECTLY ───
    checks.event_propagation = { status: 'pass', details: [] };

    const recentLifeEvents = await base44.asServiceRole.entities.LifeEvent.filter(
      { character_id: characterId },
      '-timestamp',
      5
    );

    for (const event of recentLifeEvents) {
      // Event should have created follow-up changes
      if (event.event_type === 'BAD_WORKDAY' || event.event_type === 'high_stress_shift') {
        // Expect mental/energy to be affected
        if (char.mental_value > 70) {
          issues.push({
            code: 'EVENT_NOT_PROPAGATED',
            severity: 'medium',
            message: `${event.event_type} occurred but needs were not updated`,
            affects: ['needs', 'behaviour'],
          });
          checks.event_propagation.status = 'warning';
        }
      }
    }

    // ─── CHECK 4: ARE RELATIONSHIPS REFLECTING EFFORT ───
    checks.effort_integration = { status: 'pass', details: [] };

    const memoryLog = await base44.asServiceRole.entities.Memory.filter(
      { character_id: characterId },
      '-timestamp',
      10
    );

    const effortMemories = memoryLog.filter(m => m.source_context === 'effort' || m.source_context === 'relationship_milestone');
    if (effortMemories.length > 2) {
      // Should see relationship changes
      const relationships = char.fictional_relationships || [];
      if (relationships.length === 0 || relationships.every(r => r.friendship_level <= 50)) {
        issues.push({
          code: 'MEMORY_NOT_SHARED',
          severity: 'medium',
          message: `${effortMemories.length} effort/relationship memories exist but relationships not updated`,
          affects: ['effort_system', 'relationships'],
        });
        checks.effort_integration.status = 'warning';
      }
    }

    // ─── CHECK 5: IS UI CONSISTENT ACROSS ALL VIEWS ───
    checks.ui_consistency = { status: 'pass', details: [] };

    // Character card says location X, but presence status says Y
    if (char.resolved_current_location_id && char.resolved_presence_status) {
      const locationName = char.resolved_current_location_name || 'unknown';
      const expectedStatus = char.resolved_current_location_id === char.current_home_location_id ? 'home' : 'at_location';
      if (!char.resolved_presence_status.includes(expectedStatus) && char.resolved_presence_status !== 'traveling') {
        issues.push({
          code: 'UI_STATE_MISMATCH',
          severity: 'high',
          message: `Character card shows ${locationName}, but presence is ${char.resolved_presence_status}`,
          affects: ['character_card', 'travel_page', 'scene'],
        });
        checks.ui_consistency.status = 'fail';
      }
    }

    // ─── CHECK 6: ARE ARCS INFLUENCING BEHAVIOR ───
    checks.arc_influence = { status: 'pass', details: [] };

    const arcNoteExists = !!char.character_evolution_note;
    const hasRecentNegativeEvents = recentLifeEvents.filter(e => e.valence === 'negative').length >= 3;

    if (hasRecentNegativeEvents && !arcNoteExists) {
      issues.push({
        code: 'CHARACTER_INCONSISTENCY',
        severity: 'low',
        message: `Multiple negative events forming arc but no evolution note reflects this`,
        affects: ['character_evolution', 'behaviour'],
      });
      checks.arc_influence.status = 'warning';
    }

    // If arc exists, should affect behavior
    if (arcNoteExists && char.mental_value > 75) {
      // Burnout arc should lower mental
      if (arcNoteExists.toLowerCase().includes('burnout')) {
        issues.push({
          code: 'LOGIC_CONFLICT',
          severity: 'medium',
          message: `Burnout arc noted but mental value is high (should be low)`,
          affects: ['arcs', 'needs', 'behaviour'],
        });
        checks.arc_influence.status = 'warning';
      }
    }

    // ─── CHECK 7: ARE FEATURES CONNECTED OR ISOLATED ───
    checks.feature_connection = { status: 'pass', details: [] };

    const hasAchievements = true; // assume achievements exist
    const hasGroupChats = true; // assume group chats exist
    const hasMoments = (char.current_life_event?.length || 0) > 0;

    // Check if moments are tied to arcs
    if (hasMoments && !arcNoteExists) {
      checks.feature_connection.details.push('Moments exist but no arc to contextualize them');
    }

    // Check if group chats reference relationships
    const relationships = char.fictional_relationships || [];
    if (relationships.length === 0) {
      issues.push({
        code: 'FEATURE_ISOLATION',
        severity: 'low',
        message: `No relationships defined — group chat and relationship features may feel disconnected`,
        affects: ['group_chat', 'relationships'],
      });
      checks.feature_connection.status = 'warning';
    }

    // ─── SUMMARY ───
    const passCount = Object.values(checks).filter(c => c.status === 'pass').length;
    const totalChecks = Object.keys(checks).length;
    const healthScore = Math.round((passCount / totalChecks) * 100);

    return Response.json({
      success: true,
      characterId,
      characterName: char.name,
      healthScore,
      checks,
      issues: issues.map(i => ({
        code: i.code,
        severity: i.severity,
        message: i.message,
        affects: i.affects,
        description: ISSUE_CODES[i.code],
      })),
      summary: {
        total_checks: totalChecks,
        passed: passCount,
        failed: issues.filter(i => i.severity === 'high').length,
        warnings: issues.filter(i => i.severity === 'medium').length,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});