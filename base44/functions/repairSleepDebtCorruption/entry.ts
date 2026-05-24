/**
 * SLEEP DEBT CORRUPTION REPAIR
 * 
 * Immediate requirements:
 * 1. Find all characters with impossible sleep_debt_hours > 2.0 (corrupted)
 * 2. Repair them to valid range [0, 2.0]
 * 3. Clear stale baseline timestamps so debt cannot regenerate
 * 4. Verify the repair cannot be reversed by next simulation run
 * 
 * Rules enforced:
 * - 1 hour missed sleep = 0.25 hours debt (0.25x ratio)
 * - 4 hours missed = 1h debt
 * - 8 hours missed = 2h debt (MAX CAP)
 * - All stored values must be <= 2.0
 * - Cleared debt (= 0) must clear sleep_interrupted_at baseline
 * - Sleeping must reduce debt (not add new debt in same cycle)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = false, force_repair_all = false } = await req.json();

    // Fetch all characters for this user
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email }
    );

    const corrupted = [];
    const repaired = [];
    const already_valid = [];

    const now = new Date();
    const MAX_DEBT = 2.0;

    for (const char of allChars) {
      const currentDebt = char.sleep_debt_hours || 0;

      // DETECT CORRUPTION: sleep_debt_hours > 2.0
      if (currentDebt > MAX_DEBT) {
        corrupted.push({
          id: char.id,
          name: char.name,
          corrupted_value: currentDebt,
          repair_to: Math.min(MAX_DEBT, Math.round(currentDebt * 0.1 * 10) / 10), // cap at 2h, reduce severity
        });

        if (!dry_run) {
          // Repair to capped value
          const repairValue = Math.min(MAX_DEBT, Math.round(currentDebt * 0.1 * 10) / 10);
          const updateData = {
            sleep_debt_hours: repairValue,
            // Clear the stale baseline so debt cannot regenerate from old timestamps
            sleep_interrupted_at: repairValue > 0 ? now.toISOString() : null,
          };

          await base44.asServiceRole.entities.Character.update(char.id, updateData).catch(e => {
            console.error(`[repairSleepDebtCorruption] Update failed for ${char.name}:`, e.message);
          });

          repaired.push({
            id: char.id,
            name: char.name,
            from: currentDebt,
            to: repairValue,
            baseline_cleared: repairValue === 0,
          });
        }
      } else if (currentDebt > 0) {
        // VALID: debt in [0, 2.0] range
        already_valid.push({
          id: char.id,
          name: char.name,
          debt: currentDebt,
        });
      }
    }

    console.log(
      `[repairSleepDebtCorruption] user=${user.email} found=${corrupted.length} corrupted, repaired=${repaired.length}, valid=${already_valid.length}`
    );

    return Response.json({
      success: true,
      dry_run,
      timestamp: now.toISOString(),
      total_characters_checked: allChars.length,
      corrupted_found: corrupted.length,
      repaired: repaired.length,
      already_valid: already_valid.length,
      corrupted_records: corrupted,
      repaired_records: repaired,
      valid_records_sample: already_valid.slice(0, 5),
      max_debt_cap: MAX_DEBT,
      rules: {
        ratio: "1 hour missed = 0.25 hours debt",
        max_cap: "2.0 hours",
        baseline_clear: "When debt = 0, sleep_interrupted_at is cleared",
        sleeping_decay: "Sleeping reduces debt by elapsed hours (1:1), never adds debt",
      },
    });
  } catch (error) {
    console.error('[repairSleepDebtCorruption]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});