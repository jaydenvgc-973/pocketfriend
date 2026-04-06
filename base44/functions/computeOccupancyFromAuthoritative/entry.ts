/**
 * OCCUPANCY COMPUTATION — READ ONLY
 * 
 * This function is the ONLY source of truth for location occupancy.
 * It computes occupancy PURELY from character current_location_id.
 * No occupancy arrays should ever be written to Location records.
 * 
 * Use this to:
 * - Display who's at a location in the UI
 * - Check home access
 * - Show venue occupancy
 * 
 * DO NOT: Write the result back to Location.resident_character_ids or worker_character_ids
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { locationId, locationIds } = payload;

    // Get all characters
    const characters = await base44.entities.Character.filter({ 
      created_by: user.email, 
      status: "active" 
    });

    // Get location map
    const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locations = res?.data?.locations || [];
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Helper: import the resolver (we can't import, so inline the logic)
    const getAuthoritativeLocation = (character) => {
      // Sleep
      if (character.current_activity?.toLowerCase().includes('sleep')) {
        return character.current_home_location_id;
      }

      // Work schedule
      if (character.work_start_time && character.work_end_time && character.work_days) {
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay();
        const start = parseInt(character.work_start_time.split(':')[0]);
        const end = parseInt(character.work_end_time.split(':')[0]);

        if (character.work_days.includes(day) && hour >= start && hour < end && character.occupation_location_id) {
          return character.occupation_location_id;
        }
      }

      // School
      if (character.student_status === 'enrolled' && character.education_location_id) {
        return character.education_location_id;
      }

      // Explicit current location (travel, events)
      if (character.current_location_id && character.current_location_id !== character.current_home_location_id) {
        return character.current_location_id;
      }

      // Home fallback
      return character.current_home_location_id;
    };

    // Compute occupancy
    const occupancy = {};
    for (const char of characters) {
      const locId = getAuthoritativeLocation(char);
      if (locId) {
        occupancy[locId] = occupancy[locId] || [];
        occupancy[locId].push({
          characterId: char.id,
          characterName: char.name,
        });
      }
    }

    // If specific location IDs requested, return only those
    if (locationId) {
      return Response.json({
        status: 'success',
        locationId,
        occupancy: occupancy[locationId] || [],
      });
    }

    if (locationIds && Array.isArray(locationIds)) {
      const result = {};
      for (const id of locationIds) {
        result[id] = occupancy[id] || [];
      }
      return Response.json({
        status: 'success',
        occupancy: result,
      });
    }

    // Return all occupancy
    return Response.json({
      status: 'success',
      occupancy,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});