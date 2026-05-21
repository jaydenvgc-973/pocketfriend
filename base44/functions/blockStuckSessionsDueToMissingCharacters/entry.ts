/**
 * blockStuckSessionsDueToMissingCharacters
 *
 * Emergency function: Mark all "arrived" travel sessions as "blocked" with
 * reason "Character not found in database" when they cannot be completed.
 *
 * This prevents infinite retry loops and exposes the root issue: character records
 * are missing or inaccessible despite sessions referencing them.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const arrivedSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrived' },
      '-updated_date',
      100
    ).catch(() => []);

    console.log(`[blockStuckSessionsDueToMissingCharacters] Found ${arrivedSessions.length} arrived sessions`);

    let blocked = 0;
    const results = [];

    for (const session of arrivedSessions) {
      try {
        // Try to fetch character
        const [char] = await base44.asServiceRole.entities.Character.filter(
          { id: session.character_id },
          null,
          1
        ).catch(() => []);

        if (!char) {
          // Character not found — mark session as blocked
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status: 'blocked',
            blocker_reason: `Character ${session.character_id} (${session.character_name}) not found in database`,
          });

          blocked++;
          results.push({
            session_id: session.id,
            character_name: session.character_name,
            character_id: session.character_id,
            action: 'marked_blocked',
            reason: 'character_not_found',
          });

          console.log(
            `[blockStuckSessionsDueToMissingCharacters] ⚠️ Session ${session.id} (${session.character_name}) marked blocked — character not found`
          );
        }
      } catch (e) {
        console.error(`[blockStuckSessionsDueToMissingCharacters] Error processing session ${session.id}: ${e.message}`);
      }
    }

    console.log(`[blockStuckSessionsDueToMissingCharacters] Complete | blocked=${blocked}`);

    return Response.json({
      total_sessions: arrivedSessions.length,
      marked_blocked: blocked,
      results,
    });

  } catch (error) {
    console.error('[blockStuckSessionsDueToMissingCharacters]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});