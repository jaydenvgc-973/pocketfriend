import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RETURN-HOME AUTOMATION
 * Runs at 1:00 AM ET daily.
 * Forces all npc_fictitious residents of VGC Towers back home.
 * Guarantees travel window closure and home restoration.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const log = [];

    // Load this user's characters and VGC Towers location
    const [byCreatedBy, byOwnerEmail, userLocations, sharedLocations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, status: 'active' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, status: 'active' }),
      base44.entities.LocationReference.filter({ created_by: user.email }),
      base44.entities.LocationReference.filter({ scope: 'shared' }),
    ]);

    // Deduplicate characters
    const charSeen = new Set();
    const allCharacters = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (charSeen.has(c.id)) return false;
      charSeen.add(c.id);
      return true;
    });

    // Merge and deduplicate locations
    const seenIds = new Set();
    const allLocations = [...userLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    // Find VGC Towers
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) return Response.json({ error: 'VGC Towers not found', allLocationNames: allLocations.map(l => l.name) }, { status: 400 });
    const VGC_ID = vgcTowers.id;

    // Find all npc_fictitious residents of VGC Towers
    const NPC_ELIGIBLE_TYPES = ['npc', 'npc_fictitious', 'npc_regular', 'npc_family_member'];
    const vgcResidents = allCharacters.filter(c =>
      c.current_home_location_id === VGC_ID &&
      NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
      !c.protected_active &&
      (c.owner_email === user.email || c.created_by === user.email)
    );

    if (vgcResidents.length === 0) {
      return Response.json({
        success: true,
        mode: 'return_home',
        message: 'No VGC Towers residents to return',
        returned: 0,
        log,
      });
    }

    // Force all VGC residents back home
    const updates = vgcResidents
      .filter(npc => npc.resolved_current_location_id !== VGC_ID)
      .map(npc => {
        log.push(`${npc.name} → VGC Towers (return-home block)`);
        return base44.entities.Character.update(npc.id, {
          resolved_current_location_id: VGC_ID,
          resolved_current_location_name: 'VGC Towers',
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          resolved_source_reason: 'return_home_block_1am',
          presence_state: 'home',
          source_of_move: 'system',
          valid_from: now.toISOString(),
          valid_until: null,
          return_location_id: null,
        });
      });

    await Promise.all(updates);

    // Verify all residents are now at home
    const [freshByCreated, freshByOwner] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, status: 'active' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, status: 'active' }),
    ]);
    const freshSeen = new Set();
    const allFreshChars = [...freshByCreated, ...freshByOwner].filter(c => {
      if (freshSeen.has(c.id)) return false;
      freshSeen.add(c.id);
      return true;
    });

    const finalStates = vgcResidents.map(resident => {
      const fresh = allFreshChars.find(c => c.id === resident.id) || resident;
      return {
        name: resident.name,
        location: fresh.resolved_current_location_name,
        at_home: fresh.resolved_current_location_id === VGC_ID,
      };
    });

    return Response.json({
      success: true,
      mode: 'return_home',
      timestamp: now.toISOString(),
      totalVGCResidents: vgcResidents.length,
      returned: updates.length,
      finalStates,
      log,
    });

  } catch (error) {
    console.error('[returnVGCResidentsHome]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});