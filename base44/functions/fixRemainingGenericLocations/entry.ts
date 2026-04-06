import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const financialRecords = await base44.entities.CharacterFinancial.list('-created_date', 100);
    
    const fixes = [];

    // Fix Lila Green (Case Manager at VGC Medical Center)
    const lila = characters.find(c => c.name === 'Lila Green');
    if (lila && !lila.current_location_id) {
      // Find her work location by ID
      let targetLoc = null;
      if (lila.current_work_location_id) {
        targetLoc = locations.find(l => l.id === lila.current_work_location_id);
      }
      if (!targetLoc) {
        // Fallback: find medical center
        targetLoc = locations.find(l => l.name && l.name.toLowerCase().includes('medical'));
      }
      if (targetLoc) {
        await base44.entities.Character.update(lila.id, { current_location_id: targetLoc.id });
        fixes.push({
          name: lila.name,
          assignedLocation: targetLoc.name,
          locationId: targetLoc.id
        });
      }
    }

    // Fix Ava Dei Park (Game Designer at Estrellas boutique)
    const ava = characters.find(c => c.name === 'Ava Dei Park');
    if (ava && !ava.current_location_id) {
      let targetLoc = null;
      if (ava.current_work_location_id) {
        targetLoc = locations.find(l => l.id === ava.current_work_location_id);
      }
      if (!targetLoc) {
        // Fallback: find Estrellas or any boutique
        targetLoc = locations.find(l => l.name && (l.name.toLowerCase().includes('estrellas') || l.name.toLowerCase().includes('boutique')));
      }
      if (targetLoc) {
        await base44.entities.Character.update(ava.id, { current_location_id: targetLoc.id });
        fixes.push({
          name: ava.name,
          assignedLocation: targetLoc.name,
          locationId: targetLoc.id
        });
      }
    }

    return Response.json({
      fixesApplied: fixes.length,
      fixes: fixes,
      totalLocations: locations.length,
      note: 'If any character still missing location, check their current_work_location_id or manually assign'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});