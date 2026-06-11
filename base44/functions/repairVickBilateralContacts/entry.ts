import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * repairVickBilateralContacts
 *
 * Ensures that every character in Vick's fictional_relationships also has
 * Vick listed in THEIR fictional_relationships (bilateral contact repair).
 *
 * The problem this solves:
 *   Vick is npc_world_service. His record is owner_email scoped but RLS-invisible
 *   to user-scoped Character reads from the OTHER character's perspective.
 *   So ensureBilateralCharacterAwareness fails when called with Vick's ID from
 *   a character's World Contacts view — the user-scoped read of Vick returns nothing.
 *
 * This function runs as the authenticated user, uses service role for Vick reads/writes,
 * and user-scoped writes for the counterpart characters (whom the user owns).
 *
 * Idempotent — safe to call repeatedly.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    const results = { repaired: [], already_bilateral: [], skipped: [], vick_id: null };

    // 1. Find Vick for this account (service role, by character_type)
    const vickCandidates = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_world_service', owner_email: ownerEmail, status: 'active' },
      '-created_date', 10
    ).catch(() => []);

    if (!vickCandidates.length) {
      return Response.json({ success: false, message: 'No Vick Servicio found for this account', ownerEmail });
    }

    const vick = vickCandidates[0];
    results.vick_id = vick.id;
    console.log(`[repairVickBilateralContacts] Found Vick: ${vick.id} for ${ownerEmail}`);

    // 2. Get Vick's fictional_relationships — these are the contacts Vick knows about
    const vickRels = vick.fictional_relationships || [];
    if (!vickRels.length) {
      return Response.json({ success: true, message: 'Vick has no fictional_relationships to mirror', ...results });
    }

    // 3. For each character Vick knows, ensure they also know Vick
    for (const rel of vickRels) {
      const counterpartId = rel.related_character_id;
      const counterpartName = rel.person_name;

      if (!counterpartId) {
        results.skipped.push({ name: counterpartName, reason: 'no related_character_id' });
        continue;
      }

      // Fetch the counterpart character (user-scoped — must be owned by this account)
      const counterpartArr = await base44.entities.Character.filter(
        { id: counterpartId, owner_email: ownerEmail }
      ).catch(() => []);

      const counterpart = counterpartArr[0];
      if (!counterpart) {
        results.skipped.push({ id: counterpartId, name: counterpartName, reason: 'not found or not owned by this account' });
        continue;
      }

      // Check if counterpart already has Vick in their fictional_relationships
      const counterpartRels = counterpart.fictional_relationships || [];
      const alreadyHasVick = counterpartRels.some(r => r.related_character_id === vick.id);

      if (alreadyHasVick) {
        results.already_bilateral.push({ id: counterpartId, name: counterpart.name });
        console.log(`[repairVickBilateralContacts] Already bilateral: ${counterpart.name} ↔ Vick`);
        continue;
      }

      // Write Vick into counterpart's fictional_relationships (user-scoped write — user owns this character)
      await base44.entities.Character.update(counterpartId, {
        fictional_relationships: [...counterpartRels, {
          person_name: vick.name,
          related_character_id: vick.id,
          relationship_type: 'acquaintance',
          current_status: 'ongoing',
          friendship_level: 40,
          user_respect_level: 60,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0,
          source: 'vick_bilateral_repair',
          awareness_only: true,
        }],
      });

      results.repaired.push({ id: counterpartId, name: counterpart.name });
      console.log(`[repairVickBilateralContacts] Repaired: ${counterpart.name} now has Vick in their contacts`);
    }

    return Response.json({
      success: true,
      ownerEmail,
      vick_id: vick.id,
      vick_name: vick.name,
      total_vick_contacts: vickRels.length,
      repaired: results.repaired,
      already_bilateral: results.already_bilateral,
      skipped: results.skipped,
      message: `Bilateral repair complete. Repaired: ${results.repaired.length}, Already OK: ${results.already_bilateral.length}, Skipped: ${results.skipped.length}`,
    });

  } catch (error) {
    console.error('[repairVickBilateralContacts]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});