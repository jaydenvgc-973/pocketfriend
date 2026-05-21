/**
 * fixKhalilCarterLocation
 *
 * Uses user-scoped queries (same as UI useOwnedCharacters):
 *   base44.entities.Character.filter({ owner_email: email })
 *   base44.entities.LocationReference.filter({ owner_email: email })
 *
 * Khalil Carter is at VGC Hotel / VGC Hotel Remnant.
 * His resolved_current_location fields were corrupted/cleared during travel repairs.
 * This function restores canonical presence back to that location.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // ── Load all characters (user-scoped, same as UI) ──────────────────────
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      'created_date',
      300
    ).catch(() => []);

    const khalil = allChars.find(c => 
      (c.name || '').toLowerCase().includes('khalil') && 
      (c.display_name || '').toLowerCase().includes('carter')
    );

    if (!khalil) {
      return Response.json({
        error: 'Khalil Carter not found in user-scoped character list',
        characters_loaded: allChars.length,
        character_names: allChars.map(c => c.name || c.display_name).slice(0, 10),
      }, { status: 404 });
    }

    console.log(`[fixKhalilCarterLocation] Found Khalil Carter: ${khalil.name} (${khalil.id})`);
    console.log(`  Before: location=${khalil.resolved_current_location_name} | visibility=${khalil.location_visibility_state} | travel_status=${khalil.travel_status}`);

    // ── Load all locations (owner_email scope) ────────────────────────────
    const allLocs = await base44.entities.LocationReference.filter(
      { owner_email: ownerEmail },
      'name',
      500
    ).catch(() => []);

    // Find VGC Hotel / VGC Hotel Remnant
    const vgcHotel = allLocs.find(l => 
      (l.name || '').includes('VGC Hotel')
    );

    if (!vgcHotel) {
      return Response.json({
        error: 'VGC Hotel location not found',
        locations_loaded: allLocs.length,
        location_names: allLocs.map(l => l.name).slice(0, 10),
      }, { status: 404 });
    }

    console.log(`[fixKhalilCarterLocation] Found VGC Hotel: ${vgcHotel.name} (${vgcHotel.id})`);

    // ── Update Khalil's canonical presence ────────────────────────────────
    const now = new Date();
    await base44.entities.Character.update(khalil.id, {
      resolved_current_location_id:   vgcHotel.id,
      resolved_current_location_name: vgcHotel.name,
      resolved_presence_status:       'visiting',
      resolved_location_type:         'visit',
      resolved_source_reason:         'khalil_location_restoration',
      resolved_last_updated_at:       now.toISOString(),
      travel_status:                  'not_traveling',
      traveling_to_location_id:       null,
      traveling_to_location_name:     null,
      travel_destination_location_id: null,
      location_visibility_state:      'visible',
    });

    console.log(`[fixKhalilCarterLocation] ✅ Updated Khalil to ${vgcHotel.name}`);

    // ── Read back and verify ─────────────────────────────────────────────
    const freshChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      'created_date',
      300
    ).catch(() => []);
    const khalilAfter = freshChars.find(c => c.id === khalil.id);

    const locationWriteOk = khalilAfter?.resolved_current_location_id === vgcHotel.id;
    const visibilityOk = khalilAfter?.location_visibility_state === 'visible';
    const travelClearedOk = khalilAfter?.travel_status === 'not_traveling';

    console.log(`[fixKhalilCarterLocation] After: location=${khalilAfter?.resolved_current_location_name} | visibility=${khalilAfter?.location_visibility_state} | travel_status=${khalilAfter?.travel_status}`);

    return Response.json({
      success: locationWriteOk && visibilityOk && travelClearedOk,
      character: {
        id: khalil.id,
        name: khalil.name,
        before_location: khalil.resolved_current_location_name,
        before_visibility_state: khalil.location_visibility_state,
        before_travel_status: khalil.travel_status,
        after_location: khalilAfter?.resolved_current_location_name,
        after_visibility_state: khalilAfter?.location_visibility_state,
        after_travel_status: khalilAfter?.travel_status,
        location_write_verified: locationWriteOk,
        visibility_verified: visibilityOk,
        travel_cleared_verified: travelClearedOk,
        vgc_hotel_id: vgcHotel.id,
        vgc_hotel_name: vgcHotel.name,
      },
    });

  } catch (error) {
    console.error('[fixKhalilCarterLocation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});