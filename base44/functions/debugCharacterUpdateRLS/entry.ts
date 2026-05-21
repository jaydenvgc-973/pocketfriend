/**
 * debugCharacterUpdateRLS
 * 
 * Test why updateCharacterArrivalState is rejecting writes.
 * Attempt the exact update Khalil's arrival would require.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Khalil's exact state
    const khalilId = '6a0299e0dd588e28cb48df8a';
    const destLocId = '69d7221e5e3dafcc7357fc35';

    // Load current Khalil
    const [khalil] = await base44.entities.Character.filter({ id: khalilId }, null, 1);
    if (!khalil) return Response.json({ error: 'Khalil not found' }, { status: 404 });

    // Load destination
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter({ id: destLocId }, null, 1);
    if (!destLoc) return Response.json({ error: 'Destination not found' }, { status: 404 });

    console.log(`[debugCharacterUpdateRLS] Khalil owner: ${khalil.owner_email}, Dest owner: ${destLoc.owner_email}`);

    // Attempt 1: User-scoped write (Character RLS allows this for user's own character)
    console.log(`[debugCharacterUpdateRLS] Attempt 1: User-scoped Character update...`);
    try {
      await base44.entities.Character.update(khalilId, {
        resolved_current_location_id: destLocId,
        resolved_current_location_name: destLoc.name,
        resolved_presence_status: 'visiting',
        resolved_location_type: 'visit',
        resolved_source_reason: 'test_arrival_debug',
        resolved_last_updated_at: new Date().toISOString(),
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
      });
      console.log(`[debugCharacterUpdateRLS] ✅ User-scoped update SUCCEEDED`);
      return Response.json({ success: true, attempt: 'user_scoped', result: 'SUCCEEDED' });
    } catch (e) {
      console.error(`[debugCharacterUpdateRLS] ❌ User-scoped update FAILED: ${e.message}`);
      
      // Attempt 2: Service-role write (should fail due to RLS)
      console.log(`[debugCharacterUpdateRLS] Attempt 2: Service-role Character update...`);
      try {
        await base44.asServiceRole.entities.Character.update(khalilId, {
          resolved_current_location_id: destLocId,
          resolved_current_location_name: destLoc.name,
          resolved_presence_status: 'visiting',
        });
        console.log(`[debugCharacterUpdateRLS] ⚠️ Service-role update SUCCEEDED (unexpected!)`);
        return Response.json({ success: true, attempt: 'service_role', result: 'SUCCEEDED' });
      } catch (e2) {
        console.error(`[debugCharacterUpdateRLS] ❌ Service-role update FAILED: ${e2.message}`);
        return Response.json({
          success: false,
          attempt_user_scoped: {
            status: 'FAILED',
            error: e.message,
          },
          attempt_service_role: {
            status: 'FAILED',
            error: e2.message,
          },
          diagnosis: 'Character update is blocked in BOTH user-scoped and service-role contexts',
          root_cause_candidates: [
            'Character RLS is too restrictive',
            'Character record itself is invalid/corrupted',
            'Database connection issue',
            'Character ID mismatch',
          ],
        });
      }
    }

  } catch (error) {
    console.error('[debugCharacterUpdateRLS]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});