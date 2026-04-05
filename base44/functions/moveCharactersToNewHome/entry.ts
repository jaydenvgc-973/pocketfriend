import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      sourceHomeId,
      destinationHomeId,
      moversToMove = [],   // array of active character IDs
      npcMovers = [],      // array of { name, relationship_type, source_character_id, isNPC }
      newHomeName,
    } = await req.json();

    if (!destinationHomeId) {
      return Response.json({ error: 'Missing destinationHomeId' }, { status: 400 });
    }

    // Fetch destination home (source is optional — character may not have had a home)
    const destHomes = await base44.entities.LocationReference.filter({ id: destinationHomeId });
    if (destHomes.length === 0) {
      return Response.json({ error: 'Destination home not found' }, { status: 404 });
    }
    const dest = destHomes[0];

    let source = null;
    if (sourceHomeId) {
      const sourceHomes = await base44.entities.LocationReference.filter({ id: sourceHomeId });
      source = sourceHomes[0] || null;
    }

    // ── Move active characters ────────────────────────────────────────────────
    const destResidents = new Set(dest.resident_character_ids || []);
    const destNames = new Set(dest.resident_character_names || []);

    const movedCharacters = [];
    for (const moverId of moversToMove) {
      const chars = await base44.entities.Character.filter({ id: moverId });
      if (chars.length > 0) {
        destResidents.add(moverId);
        destNames.add(chars[0].name);
        movedCharacters.push(chars[0]);
      }
    }

    // ── Move NPC family members ───────────────────────────────────────────────
    const destFamilyMembers = [...(dest.resident_family_members || [])];
    for (const npc of npcMovers) {
      if (!npc.name) continue;
      const alreadyThere = destFamilyMembers.some(f => f.name === npc.name);
      if (!alreadyThere) {
        destFamilyMembers.push({
          name: npc.name,
          relationship_type: npc.relationship_type || "Family",
          source_character_id: npc.source_character_id || null,
          isNPC: npc.isNPC || true,
        });
      }
    }

    // Update destination home
    await base44.entities.LocationReference.update(destinationHomeId, {
      name: newHomeName || dest.name,
      resident_character_ids: Array.from(destResidents),
      resident_character_names: Array.from(destNames),
      resident_family_members: destFamilyMembers,
    });

    // ── Update source home — remove movers ───────────────────────────────────
    if (source) {
      const sourceResidents = (source.resident_character_ids || []).filter(
        id => !moversToMove.includes(id)
      );
      const sourceNames = (source.resident_character_names || []).filter(
        name => !movedCharacters.some(c => c.name === name)
      );
      // Remove moved NPCs from source family members
      const npcMoverNames = new Set(npcMovers.map(n => n.name));
      const sourceFamilyMembers = (source.resident_family_members || []).filter(
        fm => !npcMoverNames.has(fm.name)
      );

      await base44.entities.LocationReference.update(sourceHomeId, {
        resident_character_ids: sourceResidents,
        resident_character_names: sourceNames,
        resident_family_members: sourceFamilyMembers,
      });
    }

    // ── Update each character's home reference ────────────────────────────────
    for (const movedChar of movedCharacters) {
      await base44.entities.Character.update(movedChar.id, {
        current_home_location_id: destinationHomeId,
      });
    }

    // ── Create memory of the move ─────────────────────────────────────────────
    for (const movedChar of movedCharacters) {
      await base44.entities.CharacterMemory.create({
        character_id: movedChar.id,
        memory_type: 'event',
        memory_text: `Moved into ${newHomeName || dest.name}`,
        memory_summary: `Moved to a new home`,
        importance_score: 8,
      });
    }

    return Response.json({
      success: true,
      movedCharacters: movedCharacters.length,
      movedNpcs: npcMovers.length,
      destinationName: newHomeName || dest.name,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});