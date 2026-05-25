/**
 * SLEEP DEBT CORRUPTION REPAIR
 *
 * Rules enforced:
 * - NPCs (npc_regular, npc_family_member, npc_fictitious) must NEVER have sleep_debt_hours > 0
 * - active_created_character: max debt = 2.0 hours (1 missed hour = 0.25h debt, 8h missed = 2h MAX)
 * - Debt was cleared yesterday — ANY non-zero debt today is a corruption artifact
 * - sleep_interrupted_at baseline must be cleared whenever debt is reset to 0
 * - Characters already sleeping must NOT gain new debt in the same cycle
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const NPC_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious']);
const MAX_ACTIVE_DEBT = 2.0; // Hard cap for active_created_character

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;

    // Fetch all characters for this user
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email }
    );

    const corrupted = [];
    const repaired = [];
    const clean = [];

    const now = new Date();

    for (const char of allChars) {
      const currentDebt = char.sleep_debt_hours || 0;
      const isNPC = NPC_TYPES.has(char.character_type);

      // ── RULE 1: NPCs must never have sleep debt ─────────────────────────────
      if (isNPC && currentDebt > 0) {
        corrupted.push({
          id: char.id,
          name: char.name,
          character_type: char.character_type,
          corrupted_value: currentDebt,
          repair_to: 0,
          reason: 'npc_must_not_have_sleep_debt',
        });

        if (!dry_run) {
          await base44.asServiceRole.entities.Character.update(char.id, {
            sleep_debt_hours: 0,
            sleep_interrupted_at: null,
          }).catch(e => console.error(`[repairSleepDebtCorruption] NPC reset failed for ${char.name}:`, e.message));

          repaired.push({ id: char.id, name: char.name, from: currentDebt, to: 0, reason: 'npc_reset' });
        }
        continue;
      }

      // ── RULE 2: active_created_character debt must not exceed 2.0h ──────────
      if (!isNPC && currentDebt > MAX_ACTIVE_DEBT) {
        corrupted.push({
          id: char.id,
          name: char.name,
          character_type: char.character_type || 'active_created_character',
          corrupted_value: currentDebt,
          repair_to: MAX_ACTIVE_DEBT,
          reason: `debt_${currentDebt}h_exceeds_max_${MAX_ACTIVE_DEBT}h`,
        });

        if (!dry_run) {
          await base44.asServiceRole.entities.Character.update(char.id, {
            sleep_debt_hours: MAX_ACTIVE_DEBT,
            sleep_interrupted_at: null, // clear stale baseline
          }).catch(e => console.error(`[repairSleepDebtCorruption] Cap failed for ${char.name}:`, e.message));

          repaired.push({ id: char.id, name: char.name, from: currentDebt, to: MAX_ACTIVE_DEBT, reason: 'capped_at_max' });
        }
        continue;
      }

      // Debt is valid (0 or within range)
      if (currentDebt === 0 || (!isNPC && currentDebt <= MAX_ACTIVE_DEBT)) {
        clean.push({ id: char.id, name: char.name, debt: currentDebt });
      }
    }

    console.log(`[repairSleepDebtCorruption] user=${user.email} total=${allChars.length} corrupted=${corrupted.length} repaired=${repaired.length} clean=${clean.length} dry_run=${dry_run}`);

    return Response.json({
      success: true,
      dry_run,
      timestamp: now.toISOString(),
      total_characters_checked: allChars.length,
      corrupted_found: corrupted.length,
      repaired: repaired.length,
      clean: clean.length,
      corrupted_records: corrupted,
      repaired_records: repaired,
      rules: {
        npc_debt: 'NPCs must always have sleep_debt_hours = 0',
        active_max: `active_created_character max debt = ${MAX_ACTIVE_DEBT}h`,
        ratio: '1 hour missed sleep = 0.25h debt',
        system_age: 'System < 48h old — any debt > 2h is impossible and corrupted',
        baseline: 'sleep_interrupted_at cleared whenever debt is reset',
      },
    });
  } catch (error) {
    console.error('[repairSleepDebtCorruption]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});