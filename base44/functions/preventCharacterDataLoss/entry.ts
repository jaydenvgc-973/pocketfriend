import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * preventCharacterDataLoss
 * 
 * Ensures character home integrity and prevents accidental deletion.
 * Rules:
 * - Character homes must never be accidentally deleted
 * - Homes persist as long as the character exists
 * - If a character moves, the home becomes vacant (not deleted)
 * - Homes are NOT temporary or auto-archived
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Scan for orphaned homes (character deleted but home still referenced)
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });
    const charIds = new Set(allChars.map(c => c.id));

    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: user.email
    });

    const issues = [];
    const fixed = [];

    // Check each location for orphaned references
    for (const loc of allLocations) {
      // Check residents
      const orphanedResidents = (loc.resident_character_ids || []).filter(id => !charIds.has(id));
      if (orphanedResidents.length > 0) {
        const newResidents = (loc.resident_character_ids || []).filter(id => charIds.has(id));
        const newResidentNames = (loc.resident_character_names || []).filter((_, i) => 
          charIds.has((loc.resident_character_ids || [])[i])
        );
        
        await base44.asServiceRole.entities.LocationReference.update(loc.id, {
          resident_character_ids: newResidents,
          resident_character_names: newResidentNames,
        });
        
        fixed.push(`Removed ${orphanedResidents.length} orphaned residents from "${loc.name}"`);
      }

      // Check workers
      const orphanedWorkers = (loc.worker_character_ids || []).filter(id => !charIds.has(id));
      if (orphanedWorkers.length > 0) {
        const newWorkers = (loc.worker_character_ids || []).filter(id => charIds.has(id));
        const newPayRates = { ...(loc.worker_pay_rates || {}) };
        const newPayTypes = { ...(loc.worker_pay_type || {}) };
        const newJobTitles = { ...(loc.worker_job_titles || {}) };
        const newShifts = { ...(loc.worker_shifts || {}) };
        
        orphanedWorkers.forEach(id => {
          delete newPayRates[id];
          delete newPayTypes[id];
          delete newJobTitles[id];
          delete newShifts[id];
        });

        await base44.asServiceRole.entities.LocationReference.update(loc.id, {
          worker_character_ids: newWorkers,
          worker_pay_rates: newPayRates,
          worker_pay_type: newPayTypes,
          worker_job_titles: newJobTitles,
          worker_shifts: newShifts,
        });
        
        fixed.push(`Removed ${orphanedWorkers.length} orphaned workers from "${loc.name}"`);
      }

      // Check owner
      if (loc.owner_character_id && !charIds.has(loc.owner_character_id)) {
        await base44.asServiceRole.entities.LocationReference.update(loc.id, {
          owner_character_id: null,
          owner_character_name: null,
        });
        fixed.push(`Cleared orphaned owner reference from "${loc.name}"`);
      }
    }

    // Verify each active character has a home
    for (const char of allChars) {
      if (char.status === 'active') {
        // Check if character has a home location
        if (!char.home_location_id) {
          // Character should have a home - this is an integrity issue
          issues.push({
            characterId: char.id,
            characterName: char.name,
            issue: 'No home location assigned',
          });
        } else {
          // Verify home still exists
          const homeLoc = allLocations.find(l => l.id === char.home_location_id);
          if (!homeLoc) {
            issues.push({
              characterId: char.id,
              characterName: char.name,
              issue: `Home location (${char.home_location_id}) no longer exists`,
            });
          }
        }
      }
    }

    return Response.json({
      success: true,
      fixed,
      issues,
      summary: {
        cleanedReferences: fixed.length,
        integrityIssuesDetected: issues.length,
      },
    });
  } catch (error) {
    console.error('[preventCharacterDataLoss]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});