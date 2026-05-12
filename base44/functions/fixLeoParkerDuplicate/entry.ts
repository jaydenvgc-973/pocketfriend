/**
 * Fix Leo Parker Duplicate Identity
 * 
 * EVIDENCE (from diagnosticLeoParkerDuplicates):
 * - Primary:  6a039f569bc9c8025eb29cb9 (Nathan fictional_rel + Lila family_row already point here)
 * - Ghost:    6a039f4fdfdc05075f810344 (created 7s earlier, ZERO references)
 * 
 * ACTION:
 * 1. Verify ghost has zero references (safety check before removal)
 * 2. Soft-delete the ghost record (status = "soft_deleted")
 * 3. Ensure Nathan Parker family_members[] _linked_character_id = primary
 * 4. Ensure Lila Green family_members[] _linked_character_id = primary
 * 5. Ensure Nathan fictional_relationships related_character_id = primary
 * 6. Return before/after proof
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PRIMARY_ID = '6a039f569bc9c8025eb29cb9';
const GHOST_ID   = '6a039f4fdfdc05075f810344';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = [];

  try {
    // Step 1: Safety check — confirm ghost is truly orphaned (no references)
    const allCharacters = await base44.entities.Character.filter({ owner_email: user.email }, '', 500);

    const ghostRefs = [];
    for (const char of allCharacters) {
      if (char.id === GHOST_ID || char.id === PRIMARY_ID) continue;

      (char.fictional_relationships || []).forEach(rel => {
        if (rel.related_character_id === GHOST_ID) {
          ghostRefs.push({ source: char.name, type: 'fictional_relationship' });
        }
      });

      (char.family_members || []).forEach(fm => {
        if (fm._linked_character_id === GHOST_ID) {
          ghostRefs.push({ source: char.name, type: 'family_member_row' });
        }
      });
    }

    results.push({ step: 'safety_check', ghostRefs, safe: ghostRefs.length === 0 });

    if (ghostRefs.length > 0) {
      // Ghost still has live references — migrate them first
      for (const char of allCharacters) {
        if (char.id === GHOST_ID || char.id === PRIMARY_ID) continue;

        let changed = false;

        const updatedFR = (char.fictional_relationships || []).map(rel => {
          if (rel.related_character_id === GHOST_ID) {
            changed = true;
            return { ...rel, related_character_id: PRIMARY_ID };
          }
          return rel;
        });

        const updatedFM = (char.family_members || []).map(fm => {
          if (fm._linked_character_id === GHOST_ID) {
            changed = true;
            return { ...fm, _linked_character_id: PRIMARY_ID };
          }
          return fm;
        });

        if (changed) {
          await base44.entities.Character.update(char.id, {
            fictional_relationships: updatedFR,
            family_members: updatedFM,
          });
          results.push({ step: 'migrated_references', character: char.name, id: char.id });
        }
      }
    }

    // Step 2: Soft-delete the ghost
    await base44.entities.Character.update(GHOST_ID, { status: 'soft_deleted' });
    results.push({ step: 'ghost_soft_deleted', ghostId: GHOST_ID });

    // Step 3: Ensure Nathan Parker family_members _linked_character_id = PRIMARY_ID
    const nathan = allCharacters.find(c => c.id === '69c7b299fe07fcd80eedfdfc');
    if (nathan) {
      const updatedFM = (nathan.family_members || []).map(fm => {
        const isLeo = fm.name?.toLowerCase() === 'leo parker' ||
                      fm._linked_character_id === PRIMARY_ID ||
                      fm._linked_character_id === GHOST_ID;
        if (isLeo) {
          return { ...fm, _linked_character_id: PRIMARY_ID };
        }
        return fm;
      });

      const updatedFR = (nathan.fictional_relationships || []).map(rel => {
        if (rel.related_character_id === GHOST_ID || 
            (rel.related_character_id === PRIMARY_ID && rel.relationship_type === 'son')) {
          return { ...rel, related_character_id: PRIMARY_ID };
        }
        return rel;
      });

      await base44.entities.Character.update(nathan.id, {
        family_members: updatedFM,
        fictional_relationships: updatedFR,
      });
      results.push({ step: 'nathan_updated', nathanId: nathan.id, linkedTo: PRIMARY_ID });
    }

    // Step 4: Ensure Lila Green family_members _linked_character_id = PRIMARY_ID
    const lila = allCharacters.find(c => c.id === '69c7b299fe07fcd80eedfdfd');
    if (lila) {
      const updatedFM = (lila.family_members || []).map(fm => {
        const isLeo = fm.name?.toLowerCase() === 'leo parker' ||
                      fm._linked_character_id === PRIMARY_ID ||
                      fm._linked_character_id === GHOST_ID;
        if (isLeo) {
          return { ...fm, _linked_character_id: PRIMARY_ID };
        }
        return fm;
      });

      await base44.entities.Character.update(lila.id, {
        family_members: updatedFM,
      });
      results.push({ step: 'lila_updated', lilaId: lila.id, linkedTo: PRIMARY_ID });
    }

    // Step 5: Verify final state
    const finalCharacters = await base44.entities.Character.filter({ owner_email: user.email }, '', 500);
    const finalLeoRecords = finalCharacters.filter(c => c.name?.toLowerCase() === 'leo parker');

    const nathanFinal = finalCharacters.find(c => c.id === '69c7b299fe07fcd80eedfdfc');
    const lilaFinal = finalCharacters.find(c => c.id === '69c7b299fe07fcd80eedfdfd');

    const nathanLeoLink = nathanFinal?.family_members?.find(fm =>
      fm.name?.toLowerCase() === 'leo parker' || fm._linked_character_id === PRIMARY_ID
    )?._linked_character_id;

    const lilaLeoLink = lilaFinal?.family_members?.find(fm =>
      fm.name?.toLowerCase() === 'leo parker' || fm._linked_character_id === PRIMARY_ID
    )?._linked_character_id;

    return Response.json({
      success: true,
      steps: results,
      verification: {
        leo_parker_active_records: finalLeoRecords.filter(c => c.status !== 'soft_deleted' && c.status !== 'deleted').length,
        leo_parker_ghost_status: finalLeoRecords.find(c => c.id === GHOST_ID)?.status || 'not found',
        primary_id: PRIMARY_ID,
        nathan_family_leo_link: nathanLeoLink,
        nathan_linked_to_primary: nathanLeoLink === PRIMARY_ID,
        lila_family_leo_link: lilaLeoLink,
        lila_linked_to_primary: lilaLeoLink === PRIMARY_ID,
        all_records: finalLeoRecords.map(c => ({ id: c.id, status: c.status, characterType: c.character_type }))
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, steps: results }, { status: 500 });
  }
});