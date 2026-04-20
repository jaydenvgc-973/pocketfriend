import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // CRITICAL: Only murqart@gmail.com
    if (user.email !== 'murqart@gmail.com') {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    const ORPHANED_VGC_ID = '69cc3d23381893e779718796';

    // Verify it exists and is orphaned
    const orphanedVGC = await base44.asServiceRole.entities.LocationReference.get(ORPHANED_VGC_ID).catch(() => null);
    
    if (!orphanedVGC) {
      return Response.json({
        success: true,
        message: 'Orphaned VGC not found (already deleted?)',
        deleted: false,
      });
    }

    if (orphanedVGC.created_by !== 'service+bc6c8eb9-0eb6-4620-bdb5-cb1c96251149@no-reply.base44.com' || orphanedVGC.owner_email !== null) {
      return Response.json({
        error: 'Safety check failed — location does not match expected orphaned pattern',
        location: orphanedVGC,
      }, { status: 400 });
    }

    // Check if any of murqart's characters reference it
    const murqartChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      null,
      500
    );

    const charsReferencingOrphan = murqartChars.filter(c => 
      c.current_home_location_id === ORPHANED_VGC_ID ||
      c.resolved_current_location_id === ORPHANED_VGC_ID ||
      c.occupation_location_id === ORPHANED_VGC_ID ||
      c.education_location_id === ORPHANED_VGC_ID ||
      (c.resident_character_ids || []).some(id => id === ORPHANED_VGC_ID)
    );

    console.log(`Characters referencing orphaned VGC: ${charsReferencingOrphan.length}`);

    // Reassign any characters to the canonical VGC before deleting
    if (charsReferencingOrphan.length > 0) {
      const canonicalVGC = await base44.asServiceRole.entities.LocationReference.get('69e624f9701ccdb1a1c8753f');
      
      for (const char of charsReferencingOrphan) {
        const updates = {};
        if (char.current_home_location_id === ORPHANED_VGC_ID) {
          updates.current_home_location_id = canonicalVGC.id;
        }
        if (char.resolved_current_location_id === ORPHANED_VGC_ID) {
          updates.resolved_current_location_id = canonicalVGC.id;
          updates.resolved_current_location_name = canonicalVGC.name;
        }
        if (char.occupation_location_id === ORPHANED_VGC_ID) {
          updates.occupation_location_id = canonicalVGC.id;
        }
        if (char.education_location_id === ORPHANED_VGC_ID) {
          updates.education_location_id = canonicalVGC.id;
        }
        
        if (Object.keys(updates).length > 0) {
          await base44.asServiceRole.entities.Character.update(char.id, updates);
          console.log(`Reassigned ${char.name} from orphaned to canonical VGC`);
        }
      }
    }

    // Delete the orphaned VGC
    await base44.asServiceRole.entities.LocationReference.delete(ORPHANED_VGC_ID);
    console.log(`Deleted orphaned VGC: ${ORPHANED_VGC_ID}`);

    return Response.json({
      success: true,
      deleted: true,
      orphaned_vgc_id: ORPHANED_VGC_ID,
      characters_reassigned: charsReferencingOrphan.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[deleteOrphanedVGCForMurqart]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});