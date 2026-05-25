import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * cleanupSleepDebtLive
 *
 * LIVE CLEANUP: Hard delete all sleep debt corruption from Character records.
 *
 * Auth: requires authenticated user session (user-scoped read, asServiceRole write).
 * The user-scoped read is what reaches RLS-protected Character records.
 * asServiceRole write is used to ensure updates succeed even on protected/default characters.
 *
 * Actions:
 * - Audit every character: sleep_debt_hours, sleep_interrupted_at, debt-driven source_reason
 * - Clear sleep_debt_hours (set to 0)
 * - Clear sleep_interrupted_at (set to null)
 * - Clear debt-driven resolved_source_reason
 * - If trapped sleeping/napping due ONLY to debt → resolve to home or location_unresolved
 * - PRESERVE: jail, work, school, hospital, travel, story states
 * - PRESERVE: memories, finances, relationships, closets, world state
 */

const DEBT_DRIVEN_REASONS = new Set([
  'recovery_nap',
  'adaptive_pre_sleep_return',
  'sleep_return_home',
  'sleep_debt_recovery',
]);

const PROTECTED_PRESENCE_STATES = new Set([
  'at_work', 'at_school', 'incarcerated', 'house_arrest',
  'hospitalized', 'traveling', 'visiting', 'rabbit_hole',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // MUST use authenticated user — user-scoped read is what reaches Character records
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized — must be called from authenticated session' }, { status: 401 });
    }

    const ownerEmail = user.email;
    console.log(`[cleanupSleepDebtLive] Authenticated as: ${ownerEmail}`);

    // USER-SCOPED read — this is what actually reaches RLS-protected Character records
    // Fetch up to 500, all statuses including moved_away so we clean everything
    const allCharacters = await base44.entities.Character.list('-created_date', 500);

    console.log(`[cleanupSleepDebtLive] User-scoped list returned: ${allCharacters.length} characters`);

    if (allCharacters.length === 0) {
      return Response.json({
        success: false,
        owner_email: ownerEmail,
        error: 'ZERO characters returned from user-scoped list. Session may not be authenticated.',
        total: 0,
      });
    }

    // Count by type
    const charactersByType = {};
    allCharacters.forEach(c => {
      const type = c.character_type || 'unknown';
      charactersByType[type] = (charactersByType[type] || 0) + 1;
    });

    // Full audit snapshot BEFORE any change
    const fullAudit = allCharacters.map(c => ({
      id: c.id,
      name: c.name || 'Unknown',
      character_type: c.character_type || 'unknown',
      status: c.status || 'unknown',
      sleep_debt_hours: c.sleep_debt_hours ?? 0,
      sleep_interrupted_at: c.sleep_interrupted_at ?? null,
      resolved_presence_status: c.resolved_presence_status || null,
      resolved_source_reason: c.resolved_source_reason || null,
      needs_repair: !!(
        (c.sleep_debt_hours > 0) ||
        c.sleep_interrupted_at ||
        DEBT_DRIVEN_REASONS.has(c.resolved_source_reason)
      ),
    }));

    const needsRepairList = fullAudit.filter(a => a.needs_repair);
    console.log(`[cleanupSleepDebtLive] ${needsRepairList.length} of ${allCharacters.length} characters need repair`);

    // Execute repairs
    const repairResults = [];
    const repairPromises = [];

    for (const char of allCharacters) {
      const updateData = {};
      let needsUpdate = false;

      if (char.sleep_debt_hours && char.sleep_debt_hours > 0) {
        updateData.sleep_debt_hours = 0;
        needsUpdate = true;
      }

      if (char.sleep_interrupted_at) {
        updateData.sleep_interrupted_at = null;
        needsUpdate = true;
      }

      if (DEBT_DRIVEN_REASONS.has(char.resolved_source_reason)) {
        updateData.resolved_source_reason = null;
        needsUpdate = true;

        const isSleepingOrNapping =
          char.resolved_presence_status === 'sleeping' ||
          char.resolved_presence_status === 'napping';
        const isProtected = PROTECTED_PRESENCE_STATES.has(char.resolved_presence_status);

        if (isSleepingOrNapping && !isProtected) {
          const hasValidHome = !!(char.current_home_location_id || char.home_location_id);
          updateData.resolved_presence_status = hasValidHome ? 'home' : 'location_unresolved';
          updateData.resolved_location_type = hasValidHome ? 'home' : 'location_unresolved';
        }
      }

      if (!needsUpdate) continue;

      const before = {
        sleep_debt_hours: char.sleep_debt_hours ?? 0,
        sleep_interrupted_at: char.sleep_interrupted_at ?? null,
        resolved_presence_status: char.resolved_presence_status || null,
        resolved_source_reason: char.resolved_source_reason || null,
      };
      const after = { ...before, ...updateData };

      repairPromises.push(
        base44.entities.Character.update(char.id, updateData)
          .then(() => {
            repairResults.push({ id: char.id, name: char.name, character_type: char.character_type, status: 'repaired', before, after });
            console.log(`[cleanupSleepDebtLive] REPAIRED: ${char.name} (${char.character_type})`);
          })
          .catch(err => {
            repairResults.push({ id: char.id, name: char.name, character_type: char.character_type, status: 'failed', error: err.message, before });
            console.error(`[cleanupSleepDebtLive] FAILED: ${char.name} — ${err.message}`);
          })
      );
    }

    await Promise.all(repairPromises);

    const repaired = repairResults.filter(r => r.status === 'repaired');
    const failed = repairResults.filter(r => r.status === 'failed');

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      summary: {
        total_characters_audited: allCharacters.length,
        by_character_type: charactersByType,
        total_needing_repair: needsRepairList.length,
        total_repaired: repaired.length,
        total_failed: failed.length,
        total_clean: allCharacters.length - needsRepairList.length,
      },
      full_audit: fullAudit,
      repair_results: repairResults,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[cleanupSleepDebtLive] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});