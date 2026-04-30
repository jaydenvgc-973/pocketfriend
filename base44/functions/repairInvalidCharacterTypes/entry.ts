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

// Map known invalid typo variants → correct canonical type
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