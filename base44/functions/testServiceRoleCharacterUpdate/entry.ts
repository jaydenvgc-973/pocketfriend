/**
 * testServiceRoleCharacterUpdate
 * 
 * Does asServiceRole.Character.update() actually work?
 * Or is it blocked by Character RLS?
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const khalilId = '6a0299e0dd588e28cb48df8a';
    const destLocId = '69d7221e5e3dafcc7357fc35';

    // Load destination
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter({ id: destLocId }, null, 1);
    if (!destLoc) return Response.json({ error: 'Destination not found' }, { status: 404 });

    const updatePayload = {
      resolved_current_location_id: destLocId,
      resolved_current_location_name: destLoc.name,
      resolved_presence_status: 'visiting',
      resolved_location_type: 'visit',
      resolved_source_reason: 'service_role_test',
      resolved_last_updated_at: new Date().toISOString(),
      travel_status: 'not_traveling',
      traveling_to_location_id: null,
      traveling_to_location_name: null,
    };

    console.log(`[testServiceRoleCharacterUpdate] Attempting asServiceRole.Character.update(${khalilId})`);

    try {
      const result = await base44.asServiceRole.entities.Character.update(khalilId, updatePayload);
      console.log(`[testServiceRoleCharacterUpdate] ✅ Service-role update SUCCEEDED`);
      
      // Verify read-back
      const [verified] = await base44.asServiceRole.entities.Character.filter({ id: khalilId }, null, 1);
      
      return Response.json({
        success: true,
        write_result: result,
        read_back: {
          location: verified?.resolved_current_location_name,
          travel_status: verified?.travel_status,
          traveling_to_id: verified?.traveling_to_location_id,
        },
      });
    } catch (writeErr) {
      console.error(`[testServiceRoleCharacterUpdate] ❌ Service-role update FAILED: ${writeErr.message}`);
      return Response.json({
        success: false,
        error: writeErr.message,
        error_code: writeErr.code,
        error_status: writeErr.status,
        diagnosis: 'asServiceRole.Character.update() is blocked by RLS or permission denial',
      });
    }

  } catch (error) {
    console.error('[testServiceRoleCharacterUpdate]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});