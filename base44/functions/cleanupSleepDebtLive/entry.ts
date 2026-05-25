import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * cleanupSleepDebtLive
 * 
 * LIVE CLEANUP: Hard delete all sleep debt corruption from Character records.
 * 
 * Scope: owner_email-scoped to the authenticated user ONLY.
 * 
 * Actions:
 * - Clear sleep_debt_hours (set to 0)
 * - Clear sleep_interrupted_at (set to null)
 * - Clear debt-driven resolved_source_reason values
 * - If resolved_presence_status was sleeping/napping due to debt, attempt re-resolution
 * - Preserve all legitimate non-debt location/travel/schedule/jail/hotel/story states
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    console.log(`[cleanupSleepDebtLive] Starting cleanup for owner_email: ${ownerEmail}`);

    // Fetch ALL characters owned by this user
    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail },
      '-created_date',
      500
    );

    console.log(`[cleanupSleepDebtLive] Found ${allCharacters.length} total characters`);

    const charactersByType = {};
    allCharacters.forEach(c => {
      const type = c.character_type || 'unknown';
      if (!charactersByType[type]) charactersByType[type] = 0;
      charactersByType[type]++;
    });

    console.log(`[cleanupSleepDebtLive] By character_type:`, JSON.stringify(charactersByType));

    // Debt-driven source reasons to clear
    const DEBT_DRIVEN_REASONS = new Set([
      'recovery_nap',
      'adaptive_pre_sleep_return',
      'sleep_return_home',
      'sleep_debt_recovery',
    ]);

    const repairLog = [];
    const updatePromises = [];

    for (const char of allCharacters) {
      const beforeSnapshot = {
        sleep_debt_hours: char.sleep_debt_hours ?? 0,
        sleep_interrupted_at: char.sleep_interrupted_at ?? null,
        resolved_presence_status: char.resolved_presence_status || null,
        resolved_source_reason: char.resolved_source_reason || null,
      };

      const updateData = {};
      let needsUpdate = false;

      // Clear sleep debt fields
      if (char.sleep_debt_hours && char.sleep_debt_hours > 0) {
        updateData.sleep_debt_hours = 0;
        needsUpdate = true;
      }

      if (char.sleep_interrupted_at) {
        updateData.sleep_interrupted_at = null;
        needsUpdate = true;
      }

      // Clear debt-driven source reason
      if (DEBT_DRIVEN_REASONS.has(char.resolved_source_reason)) {
        updateData.resolved_source_reason = null;
        needsUpdate = true;

        // If presence was sleeping/napping due to debt, clear it
        if ((char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping') &&
            DEBT_DRIVEN_REASONS.has(char.resolved_source_reason)) {
          // Preserve if character has valid non-debt reason
          // Otherwise fall back to home or location_unresolved
          const hasValidHome = !!(char.current_home_location_id || char.home_location_id);
          if (hasValidHome) {
            updateData.resolved_presence_status = 'home';
            updateData.resolved_location_type = 'home';
          } else {
            updateData.resolved_presence_status = 'location_unresolved';
            updateData.resolved_location_type = 'location_unresolved';
          }
        }
      }

      // Perform update if needed
      if (needsUpdate) {
        updatePromises.push(
          base44.asServiceRole.entities.Character.update(char.id, updateData)
            .then(() => {
              const afterSnapshot = { ...beforeSnapshot, ...updateData };
              repairLog.push({
                character_id: char.id,
                character_name: char.name || 'Unknown',
                character_type: char.character_type || 'unknown',
                before: beforeSnapshot,
                after: afterSnapshot,
              });
            })
            .catch(err => {
              repairLog.push({
                character_id: char.id,
                character_name: char.name || 'Unknown',
                character_type: char.character_type || 'unknown',
                error: err.message,
                status: 'failed',
              });
            })
        );
      }
    }

    // Wait for all updates
    await Promise.all(updatePromises);

    const successCount = repairLog.filter(r => !r.error).length;
    const failureCount = repairLog.filter(r => r.error).length;

    console.log(`[cleanupSleepDebtLive] Repair complete: ${successCount} success, ${failureCount} failed`);

    return Response.json({
      success: true,
      summary: {
        total_characters_audited: allCharacters.length,
        total_repaired: successCount,
        total_failed: failureCount,
        by_character_type: charactersByType,
        owner_email: ownerEmail,
      },
      repair_log: repairLog,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[cleanupSleepDebtLive] Error:', error.message, error.stack);
    return Response.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
});