/**
 * guardSleepNarrativeContinuity
 *
 * Ensures sleeping/resting characters stay anchored to their last verified room/surface/location.
 * Do not invent sofas, chairs, rooms, or furniture.
 * If unknown, use neutral location-safe wording.
 *
 * Called before character generates a narrative during sleep/rest.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id, owner_email } = await req.json();

    const char = await base44.entities.Character.filter({ id: character_id }).catch(() => []);
    if (!char.length) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const c = char[0];

    // Verify ownership
    if (c.owner_email !== owner_email) {
      return Response.json({ error: 'Ownership mismatch' }, { status: 403 });
    }

    // Check if sleeping or napping
    const isSleeping = ['sleeping', 'napping'].includes(c.resolved_presence_status);
    if (!isSleeping) {
      return Response.json({ sleeping: false, location_anchor: null });
    }

    // Get location where they're sleeping
    const locationId = c.resolved_current_location_id || c.current_home_location_id;
    if (!locationId) {
      return Response.json({
        sleeping: true,
        location_anchor: null,
        warning: 'No location resolved for sleeping character',
      });
    }

    const location = await base44.entities.LocationReference.filter({ id: locationId }).catch(() => []);
    if (!location.length) {
      return Response.json({
        sleeping: true,
        location_anchor: null,
        warning: 'Location not found',
      });
    }

    const loc = location[0];

    // Build neutral, safe anchor text from known data
    // DO NOT invent furniture or rooms
    let anchor = `at ${loc.name}`;

    // If there are zones in the location, pick one randomly for variety
    if (loc.zones && Array.isArray(loc.zones) && loc.zones.length > 0) {
      const randomZone = loc.zones[Math.floor(Math.random() * loc.zones.length)];
      anchor = `in ${randomZone.zone_name || 'their resting place'} at ${loc.name}`;
    }

    return Response.json({
      sleeping: true,
      character_id,
      character_name: c.name,
      location_id: locationId,
      location_name: loc.name,
      location_anchor: anchor,
      presence_status: c.resolved_presence_status,
    });

  } catch (error) {
    console.error('[guardSleepNarrativeContinuity]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});