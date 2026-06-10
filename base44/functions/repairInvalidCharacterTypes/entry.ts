import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairInvalidCharacterTypes
 *
 * Admin-only utility.
 * Finds all Character records with the invalid typo type "npc_fictitious_person"
 * (and any other non-canonical types) and corrects them to "npc_fictitious".
 *
 * Does NOT delete or recreate records — updates in-place to preserve all data.
 *
 * Canonical types: active_created_character | npc_fictitious | npc_family_member | npc_regular
 */

const CANONICAL_TYPES = new Set([
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
  'npc_regular',
]);

// ⛔ CHARACTER TYPE LOCKOUT — PERMANENT ARCHITECTURAL RULE:
// This function may ONLY correct known typo variants within the NPC type space.
// It must NEVER set character_type to 'active_created_character' or promote any
// NPC/internal/family/service character to a different class.
// character_type is USER-OWNED DATA. Promotion is exclusively a user action.
//
// PERMANENTLY FORBIDDEN corrections:
//   - Any type → 'active_created_character'
//   - Any NPC variant → non-NPC type
//   - Any inference-based correction (backstory, relationships, avatar, etc.)
//
// ALLOWED: typo-only repairs within the NPC type namespace.

// Map known invalid typo variants → correct canonical type
// LOCKOUT: all corrections must resolve within the NPC type space.
// active_created_character must NEVER appear as a correction target.
const TYPE_CORRECTIONS = {
  'npc_fictitious_person': 'npc_fictitious',
  'NPC_fictitious':        'npc_fictitious',
  'NPC_fictitious_person': 'npc_fictitious',
  'NPC_fixitious_person':  'npc_fictitious',
  'npc_fixitious_person':  'npc_fictitious',
  'npc_fictious':          'npc_fictitious',
  'npc_ficitious':         'npc_fictitious',
  'npc_fictiuous':         'npc_fictitious',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;

    // Load ALL characters via service role to see across all accounts
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 1000);

    const invalid = allChars.filter(c => !CANONICAL_TYPES.has(c.character_type));

    const results = [];
    let fixed = 0;
    let would_fix = 0;
    let unknown_type = 0;

    for (const char of invalid) {
      const correction = TYPE_CORRECTIONS[char.character_type];

      if (!correction) {
        // Unknown non-canonical type — flag but do not touch
        unknown_type++;
        results.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email,
          original_type: char.character_type,
          action: 'unknown_type_flagged',
        });
        continue;
      }

      // ⛔ HARD LOCKOUT: Never promote to active_created_character via this function.
      // character_type=active_created_character is exclusively set by user action.
      if (correction === 'active_created_character') {
        results.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email,
          original_type: char.character_type,
          action: 'blocked_promotion_attempt',
          reason: 'character_type_lockout: promoting to active_created_character is forbidden in repair functions',
        });
        console.error(`[repairInvalidCharacterTypes] ⛔ BLOCKED promotion attempt: "${char.name}" (${char.id}) → active_created_character. character_type is user-owned data.`);
        continue;
      }

      if (dry_run) {
        would_fix++;
        results.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email,
          original_type: char.character_type,
          corrected_to: correction,
          action: 'would_fix',
        });
      } else {
        await base44.asServiceRole.entities.Character.update(char.id, {
          character_type: correction,
        });
        fixed++;
        results.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email,
          original_type: char.character_type,
          corrected_to: correction,
          action: 'fixed',
        });
        console.log(`[repairInvalidCharacterTypes] Fixed "${char.name}" (${char.id}): ${char.character_type} → ${correction}`);
      }
    }

    return Response.json({
      dry_run,
      total_scanned: allChars.length,
      invalid_found: invalid.length,
      fixed,
      would_fix,
      unknown_type,
      results,
    });

  } catch (error) {
    console.error('[repairInvalidCharacterTypes]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});