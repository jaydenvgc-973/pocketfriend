/**
 * fixServiceNPCHomes
 * 
 * One-shot fix: sets current_home_location_id = VGC Towers for the 6 NPCs
 * that were created by the service account but owned by murqart@gmail.com.
 * Uses asServiceRole to bypass RLS on service-created records.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VGC_TOWERS_ID = '69cc3d23381893e779718796';

// The 6 service-account NPCs that belong to murqart@gmail.com
const NPC_IDS_TO_FIX = [
  '69cc3d5b81594eb2944c0c47', // Nick Decker
  '69cc3d2b9ac7348ad452bcfe', // Terrance Gibbons
  '69e3f96fd9761e3f08fcd4f9', // Rick Taylor
  '69cc3d674b634e4e5ca32a1f', // Jasmine Rodriguez
  '69cc3d4a1183bf2c79ecf2de', // Amelia Johnson
  '69cc3d3614d396137dacda0a', // Briar Kieran
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify these NPCs belong to this user before touching them
    const results = [];

    for (const id of NPC_IDS_TO_FIX) {
      const records = await base44.asServiceRole.entities.Character.filter({ id });
      const npc = records[0];

      if (!npc) {
        results.push({ id, status: 'not_found' });
        continue;
      }

      // Safety: only touch records owned by this user
      if (npc.owner_email !== user.email && npc.owner_user_id !== user.id) {
        results.push({ id, name: npc.name, status: 'skipped_wrong_owner', owner: npc.owner_email });
        continue;
      }

      if (npc.current_home_location_id === VGC_TOWERS_ID) {
        results.push({ id, name: npc.name, status: 'already_correct' });
        continue;
      }

      await base44.asServiceRole.entities.Character.update(id, {
        current_home_location_id: VGC_TOWERS_ID,
        resolved_current_location_id: VGC_TOWERS_ID,
        resolved_current_location_name: 'VGC Towers',
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'home_vgc_towers_fix',
      });

      results.push({ id, name: npc.name, status: 'fixed' });
    }

    const fixed = results.filter(r => r.status === 'fixed').length;
    return Response.json({ success: true, fixed, results });

  } catch (error) {
    console.error('[fixServiceNPCHomes]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});