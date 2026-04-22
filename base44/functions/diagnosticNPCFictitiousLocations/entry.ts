import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const isLockdown = hour >= 1 && hour < 10;

    // Fetch all NPCs for this user
    const [byCreatedBy, byOwnerEmail, allLocations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, character_type: 'npc_fictitious', status: 'active' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious', status: 'active' }),
      base44.entities.LocationReference.filter({ created_by: user.email }),
    ]);

    // Deduplicate
    const seen = new Set();
    const allNPCs = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    // Find VGC Towers
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    const VGC_ID = vgcTowers?.id || null;

    const diagnostics = {
      timestamp: now.toISOString(),
      hourET: hour,
      isLockdown,
      vgcTowersFound: !!vgcTowers,
      vgcTowersId: VGC_ID,
      totalNPCsFound: allNPCs.length,
      npcs: [],
      issues: [],
    };

    // Analyze each NPC
    for (const npc of allNPCs) {
      const report = {
        name: npc.name,
        id: npc.id,
        ownership: {
          created_by: npc.created_by,
          owner_email: npc.owner_email,
          matches_user: npc.created_by === user.email || npc.owner_email === user.email,
        },
        home: {
          current_home_location_id: npc.current_home_location_id,
          is_vgc: npc.current_home_location_id === VGC_ID,
        },
        location: {
          resolved_current_location_id: npc.resolved_current_location_id,
          resolved_current_location_name: npc.resolved_current_location_name,
          has_location: !!(npc.resolved_current_location_id && npc.resolved_current_location_id.length > 0),
        },
        presence: {
          resolved_presence_status: npc.resolved_presence_status,
          presence_state: npc.presence_state,
          valid_from: npc.valid_from,
          valid_until: npc.valid_until,
        },
        flags: {
          protected_active: npc.protected_active,
          is_test_character: npc.is_test_character,
        },
      };

      // Check for issues
      if (!report.location.has_location) {
        diagnostics.issues.push({
          npc: npc.name,
          issue: 'NO_LOCATION',
          details: `Missing resolved_current_location_id. Home: ${npc.current_home_location_id}. Protected: ${npc.protected_active}`,
        });
      }

      if (isLockdown && npc.presence_state !== 'home' && npc.resolved_current_location_id !== VGC_ID) {
        diagnostics.issues.push({
          npc: npc.name,
          issue: 'LOCKDOWN_VIOLATION',
          details: `At 7 AM lockdown, should be home but presence_state=${npc.presence_state}, location=${npc.resolved_current_location_name}`,
        });
      }

      if (!report.home.is_vgc && !npc.protected_active) {
        diagnostics.issues.push({
          npc: npc.name,
          issue: 'WRONG_HOME',
          details: `Home is ${npc.current_home_location_id}, not VGC Towers. Protected: ${npc.protected_active}`,
        });
      }

      diagnostics.npcs.push(report);
    }

    return Response.json(diagnostics);
  } catch (error) {
    console.error('[diagnosticNPCFictitiousLocations]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});