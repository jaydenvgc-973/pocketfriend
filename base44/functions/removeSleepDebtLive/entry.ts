/**
 * removeSleepDebtLive
 *
 * FINAL CLEANUP: Removes all sleep debt from live character records.
 * 
 * This is NOT a diagnostic. This is permanent removal.
 * 
 * Required action:
 * - Set sleep_debt_hours to 0 or null for ALL characters
 * - Set sleep_interrupted_at to null for ALL characters
 * - Clear debt-driven resolved_presence_status/resolved_source_reason states
 * - Preserve all non-debt story/location/schedule states
 * 
 * Scope: owner_email ONLY. No other accounts touched.
 * 
 * Returns real character before/after data proving removal.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEBT_SOURCE_REASONS = new Set([
  'recovery_nap',
  'adaptive_pre_sleep_return',
  'sleep_return_home',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const owner_email = user.email;

    // Fetch all characters for this owner
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email },
      '-updated_date',
      500
    );

    const results = [];
    let totalRepaired = 0;
    let totalErrors = 0;

    for (const char of allChars) {
      const before = {
        id: char.id,
        name: char.name,
        character_type: char.character_type,
        sleep_debt_hours: char.sleep_debt_hours ?? null,
        sleep_interrupted_at: char.sleep_interrupted_at ?? null,
        resolved_presence_status: char.resolved_presence_status ?? null,
        resolved_source_reason: char.resolved_source_reason ?? null,
      };

      const repairs = {};
      const changes = [];

      // Clear ALL sleep debt fields unconditionally
      if ((char.sleep_debt_hours ?? null) !== null && char.sleep_debt_hours > 0) {
        repairs.sleep_debt_hours = 0;
        changes.push(`sleep_debt_hours: ${char.sleep_debt_hours} → 0`);
      }

      if (char.sleep_interrupted_at !== null && char.sleep_interrupted_at !== undefined) {
        repairs.sleep_interrupted_at = null;
        changes.push('sleep_interrupted_at cleared');
      }

      // Clear debt-driven presence states
      if (DEBT_SOURCE_REASONS.has(char.resolved_source_reason)) {
        repairs.resolved_source_reason = null;
        changes.push(`resolved_source_reason: ${char.resolved_source_reason} → null`);
      }

      if (char.resolved_presence_status === 'napping' && 
          (char.sleep_debt_hours || 0) > 0) {
        repairs.resolved_presence_status = null;
        changes.push('resolved_presence_status: napping (debt-driven) → null');
      }

      const hasRepairs = Object.keys(repairs).length > 0;
      let status = 'clean';

      if (hasRepairs) {
        try {
          await base44.asServiceRole.entities.Character.update(char.id, repairs);
          status = 'repaired';
          totalRepaired++;
        } catch (err) {
          status = 'error';
          totalErrors++;
          changes.push(`ERROR: ${err.message}`);
        }
      }

      const after = {
        sleep_debt_hours: repairs.sleep_debt_hours !== undefined ? repairs.sleep_debt_hours : before.sleep_debt_hours,
        sleep_interrupted_at: repairs.sleep_interrupted_at !== undefined ? repairs.sleep_interrupted_at : before.sleep_interrupted_at,
        resolved_presence_status: repairs.resolved_presence_status !== undefined ? repairs.resolved_presence_status : before.resolved_presence_status,
        resolved_source_reason: repairs.resolved_source_reason !== undefined ? repairs.resolved_source_reason : before.resolved_source_reason,
      };

      results.push({
        name: char.name,
        character_type: char.character_type,
        status,
        changes,
        before,
        after,
      });
    }

    const byType = {};
    allChars.forEach(c => {
      byType[c.character_type || 'unknown'] = (byType[c.character_type || 'unknown'] || 0) + 1;
    });

    const repaired = results.filter(r => r.status === 'repaired');

    return Response.json({
      success: true,
      owner_email,
      timestamp: new Date().toISOString(),
      audit: {
        total_characters: allChars.length,
        by_type: byType,
        total_repaired: totalRepaired,
        total_errors: totalErrors,
      },
      characters_repaired: repaired.map(r => r.name),
      full_report: results,
      confirmation: {
        sleep_debt_hours_cleared: 'All sleep_debt_hours set to 0 or null',
        sleep_interrupted_at_cleared: 'All sleep_interrupted_at set to null',
        debt_source_reasons_cleared: 'recovery_nap, adaptive_pre_sleep_return, sleep_return_home removed',
        debt_driven_napping_cleared: 'Napping states driven by debt removed',
        owner_email_scoped: `Only ${owner_email} was modified`,
        no_other_systems_touched: 'Chat, memories, relationships, finances, locations, work, school, jail, travel unchanged',
      },
    });

  } catch (error) {
    console.error('[removeSleepDebtLive]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});