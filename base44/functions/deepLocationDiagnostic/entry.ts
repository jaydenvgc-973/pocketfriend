import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Deep diagnostic: Find ALL locations, check photo status, identify missing/orphaned references
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch ALL locations (not filtered)
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    
    // Fetch user's characters to see what locations they reference
    const userChars = await base44.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      500
    );

    const report = {
      totalLocations: allLocations.length,
      locationsWithImages: 0,
      locationsWithoutImages: 0,
      locationsList: [],
      charLocationReferences: {
        occupationLocations: [],
        educationLocations: [],
        residenceLocations: [],
      },
      orphanedReferences: [],
      summary: {},
    };

    // Inventory each location
    for (const loc of allLocations) {
      const zones = loc.zones || [];
      const totalImages = zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);
      const hasImages = totalImages > 0;

      if (hasImages) report.locationsWithImages++;
      else report.locationsWithoutImages++;

      report.locationsList.push({
        id: loc.id,
        name: loc.name,
        category: loc.category,
        location_type: loc.location_type,
        created_by: loc.created_by,
        zones: zones.length,
        totalImages,
        hasImages,
        residents: (loc.resident_character_ids || []).length,
        workers: (loc.worker_character_ids || []).length,
      });
    }

    // Check what locations are referenced by user's characters
    const charLocationIds = new Set();
    for (const char of userChars) {
      if (char.occupation_location_id) {
        charLocationIds.add(char.occupation_location_id);
        const locName = allLocations.find(l => l.id === char.occupation_location_id)?.name || 'MISSING';
        report.charLocationReferences.occupationLocations.push({
          characterId: char.id,
          characterName: char.name,
          locationId: char.occupation_location_id,
          locationName: locName,
        });
      }
      if (char.education_location_id) {
        charLocationIds.add(char.education_location_id);
        const locName = allLocations.find(l => l.id === char.education_location_id)?.name || 'MISSING';
        report.charLocationReferences.educationLocations.push({
          characterId: char.id,
          characterName: char.name,
          locationId: char.education_location_id,
          locationName: locName,
        });
      }
      if (char.additional_occupation_locations) {
        for (const loc of char.additional_occupation_locations) {
          if (loc.location_id) charLocationIds.add(loc.location_id);
        }
      }
      if (char.additional_education_locations) {
        for (const loc of char.additional_education_locations) {
          if (loc.location_id) charLocationIds.add(loc.location_id);
        }
      }
    }

    // Check for broken character residence links
    for (const char of userChars) {
      if (char.resident_character_ids?.length > 0) {
        for (const resId of char.resident_character_ids) {
          // Find which location this character is a resident of
          const homeLoc = allLocations.find(l => (l.resident_character_ids || []).includes(resId));
          if (homeLoc) {
            report.charLocationReferences.residenceLocations.push({
              characterId: resId,
              characterName: allLocations.find(l => l.id === resId)?.name || resId,
              homeLocationId: homeLoc.id,
              homeLocationName: homeLoc.name,
            });
          }
        }
      }
    }

    // Find orphaned references (location referenced by char but doesn't exist)
    for (const locId of charLocationIds) {
      if (!allLocations.find(l => l.id === locId)) {
        report.orphanedReferences.push({
          locationId: locId,
          status: 'MISSING - referenced but not in database',
        });
      }
    }

    // Summary
    report.summary = {
      totalLocations: report.totalLocations,
      withImages: report.locationsWithImages,
      withoutImages: report.locationsWithoutImages,
      orphanedCount: report.orphanedReferences.length,
      charReferencingLocations: charLocationIds.size,
      message: report.orphanedReferences.length > 0 
        ? `⚠️ FOUND ${report.orphanedReferences.length} ORPHANED LOCATION REFERENCES` 
        : '✓ All character location references are valid',
    };

    return Response.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error('[deepLocationDiagnostic]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});