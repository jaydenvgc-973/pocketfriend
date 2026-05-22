/**
 * enforceLocationTruthAutocorrect
 *
 * Automatically corrects location inconsistencies.
 * Makes current_location_id the single source of truth.
 * Clears any stale travel state that contradicts current presence.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = true } = await req.json();

    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    );

    const corrections = [];
    const already_correct = [];

    for (const char of allChars) {
      const hasStaleTravel = char.travel_status === 'traveling' || 
                           ['traveling', 'in_transit'].includes(char.resolved_presence_status);
      
      const hasTravelDestination = !!char.travel_destination_location_id;

      // If character is marked as traveling but has no travel destination, clear it
      if (hasStaleTravel && !hasTravelDestination) {
        if (!dry_run) {
          await base44.entities.Character.update(char.id, {
            travel_status: 'not_traveling',
            resolved_presence_status: 'home',
            resolved_current_location_id: char.current_home_location_id || char.resolved_current_location_id,
            resolved_last_updated_at: new Date().toISOString()
          }).catch(() => {});
        }

        corrections.push({
          character_id: char.id,
          character_name: char.name,
          issue: 'Stale traveling state with no destination',
          action: 'Cleared travel status, reset to home'
        });
        continue;
      }

      // If character has pending destination, don't mark them as traveling yet
      // They stay at current location until move time
      if (hasTravelDestination && hasStaleTravel) {
        if (!dry_run) {
          await base44.entities.Character.update(char.id, {
            travel_status: 'not_traveling',
            resolved_presence_status: char.resolved_presence_status !== 'traveling' ? 
              char.resolved_presence_status : 'home'
          }).catch(() => {});
        }

        corrections.push({
          character_id: char.id,
          character_name: char.name,
          issue: 'Scheduled relocation but marked as traveling',
          action: 'Cleared traveling flag, waiting for scheduled move time'
        });
        continue;
      }

      already_correct.push({
        character_id: char.id,
        character_name: char.name,
        location: char.resolved_current_location_name,
        status: 'correct'
      });
    }

    return Response.json({
      success: true,
      dry_run,
      total_checked: allChars.length,
      corrections_made: corrections.length,
      already_correct: already_correct.length,
      corrections,
      summary: `${corrections.length} location inconsistencies ${dry_run ? 'found' : 'corrected'}`
    });

  } catch (error) {
    console.error('[enforceLocationTruthAutocorrect]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});