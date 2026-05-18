import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fires when a LocationReference is created.
 * If the location has an assigned_character_id (character-specific home),
 * this automatically:
 *   1. Sets current_home_location_id on the Character record
 *   2. Ensures the character appears in resident_character_ids / resident_character_names
 *   3. Sets resolved presence fields on the Character to "home"
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const location = body.data;
    if (!location || !location.id) {
      return Response.json({ success: true, skipped: true, reason: 'No location data' });
    }

    // ── PERMANENT DUPLICATE-LOCATION GUARD ────────────────────────────────────
    // If a canonical location with the same normalized name already exists,
    // this new record is a blank shell duplicate — delete it immediately and
    // return the canonical ID so callers can reuse it.
    // This prevents any future process (community events, auto-create, etc.)
    // from accumulating blank shell duplicates alongside real configured locations.
    const normalizeLocName = (n) =>
      (n || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const newName = normalizeLocName(location.name);
    if (newName) {
      const allLocs = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
      const canonical = allLocs.find(l =>
        l.id !== location.id && normalizeLocName(l.name) === newName &&
        ((l.zones || []).length > 0 || (l.image_urls || []).length > 0 || (l.description || '').length > 10)
      );
      if (canonical) {
        console.log(`[onLocationCreated] DUPLICATE GUARD: "${location.name}" (${location.id}) matches canonical ${canonical.id} — deleting blank shell`);
        await base44.asServiceRole.entities.LocationReference.delete(location.id).catch(() => {});
        return Response.json({ success: true, skipped: true, reason: 'duplicate_shell_deleted', canonical_id: canonical.id });
      }
    }

    // Only process character-specific or account_global home locations that have an assigned character
    const charId = location.assigned_character_id || location.character_id;
    if (!charId) {
      return Response.json({ success: true, skipped: true, reason: 'No assigned_character_id' });
    }

    // Only auto-link for residential categories
    const RESIDENTIAL = new Set(['home', 'generic']);
    if (!RESIDENTIAL.has(location.category)) {
      return Response.json({ success: true, skipped: true, reason: 'Not a residential location' });
    }

    const character = await base44.asServiceRole.entities.Character.get(charId);
    if (!character) {
      return Response.json({ success: true, skipped: true, reason: 'Character not found' });
    }

    // 1. Ensure resident lists on location are populated
    const residentIds = Array.from(new Set([...(location.resident_character_ids || []), charId]));
    const residentNames = Array.from(new Set([...(location.resident_character_names || []), character.name]));
    await base44.asServiceRole.entities.LocationReference.update(location.id, {
      resident_character_ids: residentIds,
      resident_character_names: residentNames,
    });

    // 2. Link home on Character and set resolved presence
    await base44.asServiceRole.entities.Character.update(charId, {
      current_home_location_id: location.id,
      location_status: 'home',
      resolved_current_location_id: location.id,
      resolved_current_location_name: location.name,
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
    });

    console.log(`[onLocationCreated] Auto-linked ${character.name} → ${location.name}`);
    return Response.json({ success: true, characterId: charId, locationId: location.id });
  } catch (error) {
    console.error('[onLocationCreated]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});