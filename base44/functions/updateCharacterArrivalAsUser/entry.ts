/**
 * updateCharacterArrivalAsUser
 * 
 * User-scoped character update for travel arrival.
 * Called from processTravelArrivals (scheduled) via asServiceRole.functions.invoke.
 * 
 * CRITICAL: Uses user-scoped Character API (base44.entities.Character)
 * because RLS requires the authenticated user to own the character.
 * 
 * To work around "no user in scheduled context" problem:
 * We accept owner_email and character_id, then verify them,
 * and perform a synthetic user-context update via a workaround.
 * 
 * NOTE: This will still fail because we have no real user token.
 * Real solution: Have a dedicated admin function that bypasses RLS,
 * or redesign Character entity RLS to allow scheduled processes.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const { character_id, owner_email, updates } = await req.json();

    if (!character_id || !owner_email || !updates) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // We are called via asServiceRole.functions.invoke, so base44 is service-role scoped.
    // We cannot call base44.entities.Character.update directly (no user context).
    // 
    // WORKAROUND ATTEMPT:
    // Create a synthetic user-context by temporarily simulating user auth.
    // This is a HACK and will not work in real production.
    // Real fix: Redesign RLS or have an admin-bypass path.

    const base44 = createClientFromRequest(req);

    // Verify character exists and is owned by owner_email
    const charArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id, owner_email: owner_email },
      null,
      1
    ).catch(() => []);

    if (!charArr?.[0]) {
      return Response.json({
        success: false,
        error: `Character not found or ownership mismatch: ${character_id}/${owner_email}`,
      }, { status: 404 });
    }

    const char = charArr[0];

    // ── CRITICAL FIX: Use asServiceRole to write Character directly ──────────────────────
    // The problem: asServiceRole.Character.update() is blocked by RLS (403 Permission Denied)
    // 
    // REAL FIX OPTIONS:
    // A) Modify Character RLS to allow service-role updates for arrival logic
    // B) Create a custom "arrival" entity that RLS allows service-role to write, then sync back
    // C) Accept that this task CANNOT be done from a scheduled function without user context
    // 
    // For now: attempt the write and catch the 403, then return error.
    // The session will stay as arrival_failed, which is correct (honest failure).

    console.log(`[updateCharacterArrivalAsUser] Attempting Character update for ${char.name}`);

    try {
      await base44.asServiceRole.entities.Character.update(character_id, updates);
      
      // Verify write
      const verifyArr = await base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
      const verified = verifyArr?.[0];

      if (verified?.resolved_current_location_id === updates.resolved_current_location_id &&
          verified?.travel_status === 'not_traveling') {
        console.log(`[updateCharacterArrivalAsUser] ✅ Character update succeeded`);
        return Response.json({ success: true, character_id, character_name: char.name });
      } else {
        return Response.json({
          success: false,
          error: 'Destination write verification failed',
          expected_location: updates.resolved_current_location_id,
          actual_location: verified?.resolved_current_location_id,
        }, { status: 500 });
      }
    } catch (writeErr) {
      console.error(`[updateCharacterArrivalAsUser] ❌ asServiceRole Character update failed: ${writeErr.message}`);
      return Response.json({
        success: false,
        error: `Character update blocked: ${writeErr.message}`,
        error_code: writeErr.code || 'unknown',
      }, { status: 403 });
    }

  } catch (error) {
    console.error('[updateCharacterArrivalAsUser]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});