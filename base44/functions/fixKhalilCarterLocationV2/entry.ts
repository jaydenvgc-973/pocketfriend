/**
 * fixKhalilCarterLocationV2
 *
 * First, load all 48 characters and find Khalil by matching on multiple name fields.
 * Then restore his location to VGC Hotel.
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

    // ── Load all characters (user-scoped) ──────────────────────────────────
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      'created_date',
      300
    ).catch(() => []);

    // Search by any name field containing 'khalil' (case-insensitive)
    const khalil = allChars.find(c => {
      const n = (c.name || '').toLowerCase();
      const dn = (c.display_name || '').toLowerCase();
      const pn = (c.primary_name || '').toLowerCase();
      return n.includes('khalil') || dn.includes('khalil') || pn.includes('khalil');
    });

    if (!khalil) {
      // Return all character names for inspection
      return Response.json({
        error: 'Khalil not found by name matching',
        characters_loaded: allChars.length,
        all_character_names: allChars.map(c => ({
          id: c.id,
          name: c.name,
          display_name: c.display_name,
          primary_name: c.primary_name,
          resolved_location: c.resolved_current_location_name,
        })),
      }, { status: 404 });
    }

    console.log(`[fixKhalilCarterLocationV2] Found Khalil: ${khalil.name} | display: ${khalil.display_name}`);
    console.log(`  Before: location=${khalil.resolved_current_location_name} | visibility=${khalil.location_visibility_state}`);

    // ── Load all locations ────────────────────────────────────────────────
    const allLocs = await base44.entities.LocationReference.filter(
      { owner_email: ownerEmail },
      'name',
      500
    ).catch(() => []);

    const vgcHotel = allLocs.find(l => (l.name || '').includes('VGC Hotel'));

    if (!vgcHotel) {
      return Response.json({
        error: 'VGC Hotel location not found',
        locations_loaded: allLocs.length,
        location_names: allLocs.map(l => l.name).slice(0, 15),
      }, { status: 404 });
    }

    console.log(`[fixKhalilCarterLocationV2] Found VGC Hotel: ${vgcHotel.name}`);

    // ── Update Khalil ────────────────────────────────────────────────────
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

    // ── Read back ────────────────────────────────────────────────────────
    const freshChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      'created_date',
      300
    ).catch(() => []);
    const khalilAfter = freshChars.find(c => c.id === khalil.id);

    return Response.json({
      success: khalilAfter?.resolved_current_location_id === vgcHotel.id,
      character: {
        id: khalil.id,
        name: khalil.name,
        display_name: khalil.display_name,
        before_location: khalil.resolved_current_location_name,
        before_visibility: khalil.location_visibility_state,
        before_travel_status: khalil.travel_status,
        after_location: khalilAfter?.resolved_current_location_name,
        after_visibility: khalilAfter?.location_visibility_state,
        after_travel_status: khalilAfter?.travel_status,
        location_write_verified: khalilAfter?.resolved_current_location_id === vgcHotel.id,
        visibility_verified: khalilAfter?.location_visibility_state === 'visible',
        travel_cleared_verified: khalilAfter?.travel_status === 'not_traveling',
        vgc_hotel_id: vgcHotel.id,
        vgc_hotel_name: vgcHotel.name,
      },
    });

  } catch (error) {
    console.error('[fixKhalilCarterLocationV2]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});