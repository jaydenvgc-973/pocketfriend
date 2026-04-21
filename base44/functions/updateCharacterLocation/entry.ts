import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * updateCharacterLocation
 *
 * AUTHORITATIVE PRESENCE WRITER — Single source of truth for character location.
 *
 * Writes to the canonical resolved_* fields that every UI surface reads from:
 *   - Home page character cards
 *   - Travel page + all popups
 *   - Scene page presence check
 *   - Chat / narrative context
 *   - Image generation
 *
 * RULE: One character = one location at a time. This function atomically:
 *   1. Sets the new resolved location fields
 *   2. Clears any conflicting stale state (travel, previous location)
 *   3. Returns the full updated presence record
 *
 * Never writes to the legacy current_location_id or current_location_name fields.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, locationId, locationName, presenceStatus, locationType, sourceReason } = await req.json();
    if (!characterId || !locationId) {
      return Response.json({ error: 'Missing characterId or locationId' }, { status: 400 });
    }

    const chars = await base44.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    // Derive sensible defaults from context
    const resolvedStatus = presenceStatus || 'visiting';
    const resolvedType = locationType || 'visit';

    // ATOMIC WRITE: set new location, clear all conflicting stale state
    const updates = {
      // ── AUTHORITATIVE resolved fields (read by ALL UI surfaces) ──
      resolved_current_location_id: locationId,
      resolved_current_location_name: locationName || 'Unknown Location',
      resolved_location_type: resolvedType,
      resolved_presence_status: resolvedStatus,
      resolved_source_reason: sourceReason || 'manual_update',
      resolved_last_updated_at: now,
      // ── Clear travel/transit state to prevent split presence ──
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id: null,
      traveling_to_location_name: null,
    };

    await base44.entities.Character.update(characterId, updates);

    return Response.json({
      success: true,
      characterId,
      locationId,
      locationName: locationName || 'Unknown Location',
      resolvedStatus,
      resolvedType,
      updatedAt: now,
    });
  } catch (error) {
    console.error('[updateCharacterLocation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});