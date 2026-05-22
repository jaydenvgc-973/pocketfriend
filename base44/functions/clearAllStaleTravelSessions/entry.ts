/**
 * clearAllStaleTravelSessions
 *
 * Archives all existing TravelSession records and clears travel_status
 * on any character that still has one set.
 * 
 * TravelSession is no longer authoritative. This is a one-time cleanup.
 * Presence is now determined solely by resolved_current_location_id.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = false } = await req.json();
    const nowIso = new Date().toISOString();

    // 1. Get all TravelSessions for this owner
    const sessions = await base44.entities.TravelSession.filter(
      { owner_email: user.email },
      null,
      500
    );

    console.log(`[clearAllStaleTravelSessions] Found ${sessions.length} sessions for ${user.email}`);

    const sessionResults = { total: sessions.length, archived: 0, errors: 0 };

    if (!dry_run) {
      for (const session of sessions) {
        // Archive by marking cancelled — do not delete (preserve audit history)
        await base44.entities.TravelSession.update(session.id, {
          route_status: 'cancelled',
          blocker_reason: 'travel_system_deprecated_instant_relocation',
          arrival_due: false,
          arrival_pending_character_write: false,
        }).catch(() => { sessionResults.errors++; });
        sessionResults.archived++;
      }
    }

    // 2. Find all characters with stale travel_status
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    );

    const travelingStates = new Set([
      'traveling_to_work', 'traveling_to_school', 'traveling_to_destination', 'traveling'
    ]);
    const travelingPresence = new Set(['traveling', 'in_transit']);

    const staleChars = allChars.filter(c =>
      travelingStates.has(c.travel_status) ||
      travelingPresence.has(c.resolved_presence_status)
    );

    console.log(`[clearAllStaleTravelSessions] ${staleChars.length} characters with stale travel state`);

    const charResults = { total: staleChars.length, cleared: 0, errors: 0, details: [] };

    if (!dry_run) {
      for (const char of staleChars) {
        // Resolve final location: use resolved_current_location_id as truth
        // If they have a real home, return them there as fallback only if no current location
        const finalLocationId = char.resolved_current_location_id || char.current_home_location_id;
        const finalPresence = char.resolved_current_location_id
          ? 'at_location'  // they have a confirmed location — stay there
          : 'home';        // no location — return home

        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
          travel_destination_location_name: null,
          traveling_to_location_id: null,
          traveling_to_location_name: null,
          resolved_presence_status: finalPresence,
          resolved_last_updated_at: nowIso,
        }).catch(() => { charResults.errors++; return; });

        charResults.cleared++;
        charResults.details.push({
          name: char.name,
          was_travel_status: char.travel_status,
          was_presence: char.resolved_presence_status,
          now_presence: finalPresence,
          kept_location: char.resolved_current_location_name || 'home'
        });
      }
    }

    return Response.json({
      success: true,
      dry_run,
      sessions: sessionResults,
      characters: charResults,
      message: dry_run
        ? `DRY RUN: Would archive ${sessions.length} sessions and clear ${staleChars.length} characters`
        : `Archived ${sessionResults.archived} sessions. Cleared travel state on ${charResults.cleared} characters.`,
      authority: 'Presence is now resolved_current_location_id only. TravelSession is deprecated.'
    });

  } catch (error) {
    console.error('[clearAllStaleTravelSessions]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});