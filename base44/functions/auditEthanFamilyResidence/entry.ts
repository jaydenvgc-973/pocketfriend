import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ROOT CAUSE AUDIT: Ethan's Family
 *
 * Investigates whether Larry, Thomas, Vanessa, Marisol, Sarah, Stephanie,
 * and Linda Thompson are actually members of VGC Towers or if their
 * placement there is a data corruption bug.
 *
 * Shows:
 * - Character metadata
 * - Current home assignment
 * - Resolved presence location
 * - All location memberships (resident arrays, family member arrays)
 * - Whether they belong at VGC Towers or Ethan's Family Home
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetNames = [
      'Larry',
      'Thomas',
      'Vanessa',
      'Marisol',
      'Sarah',
      'Stephanie',
      'Linda Thompson',
    ];

    // Load all data
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ status: 'active' }, null, 500),
      base44.entities.LocationReference.filter({ owner_email: user.email }, null, 300),
    ]);

    const vgcTowers = locations.find(l => l.name === 'VGC Towers');
    const ethanHome = locations.find(l =>
      l.name === "Ethan's Family Home" || l.name === "Ethan Thompson's Home"
    );

    const audit = [];

    for (const targetName of targetNames) {
      // Find character by name (case-insensitive)
      const char = characters.find(c =>
        c.name?.toLowerCase().trim() === targetName.toLowerCase().trim() ||
        c.display_name?.toLowerCase().trim() === targetName.toLowerCase().trim()
      );

      if (!char) {
        audit.push({ name: targetName, found: false });
        continue;
      }

      // Find all locations where this character appears
      const residenceLocations = [];

      // Check resident_character_ids array
      for (const loc of locations) {
        if (loc.resident_character_ids?.includes(char.id)) {
          residenceLocations.push({
            location_name: loc.name,
            location_id: loc.id,
            membership_type: 'resident_character_ids',
          });
        }
      }

      // Check residents array
      for (const loc of locations) {
        if (loc.residents?.some(r => r.character_id === char.id)) {
          residenceLocations.push({
            location_name: loc.name,
            location_id: loc.id,
            membership_type: 'residents_array',
          });
        }
      }

      // Check resident_family_members array
      for (const loc of locations) {
        if (loc.resident_family_members?.some(fm => fm.name?.toLowerCase().trim() === targetName.toLowerCase().trim())) {
          residenceLocations.push({
            location_name: loc.name,
            location_id: loc.id,
            membership_type: 'resident_family_members',
          });
        }
      }

      // Determine correct home
      const homeLocId = char.current_home_location_id;
      const homeLocation = homeLocId ? locations.find(l => l.id === homeLocId) : null;
      const correctHome = homeLocation?.name || 'Unknown/None';

      // Current resolved location
      const resolvedLocId = char.resolved_current_location_id;
      const resolvedLocation = resolvedLocId ? locations.find(l => l.id === resolvedLocId) : null;
      const resolvedLocName = resolvedLocation?.name || 'Unknown/None';

      // Determine if incorrectly at VGC
      const isAtVGC = char.resolved_current_location_id === vgcTowers?.id;
      const shouldBeAtVGC = char.current_home_location_id === vgcTowers?.id;
      const incorrectlyAtVGC = isAtVGC && !shouldBeAtVGC;

      // Determine correct family home
      const belongsToEthanHome = char.current_home_location_id === ethanHome?.id ||
        residenceLocations.some(r => r.location_id === ethanHome?.id);

      audit.push({
        name: char.name,
        id: char.id,
        character_type: char.character_type,
        current_home_location_id: char.current_home_location_id,
        current_home_location_name: correctHome,
        resolved_current_location_id: char.resolved_current_location_id,
        resolved_current_location_name: resolvedLocName,
        all_residence_memberships: residenceLocations,
        is_at_vgc_towers: isAtVGC,
        should_be_at_vgc: shouldBeAtVGC,
        incorrectly_at_vgc: incorrectlyAtVGC,
        belongs_to_ethan_family_home: belongsToEthanHome,
        belongs_to_vgc_towers: shouldBeAtVGC,
      });
    }

    // Summary
    const incorrectMembers = audit.filter(a => a.incorrectlyAtVGC && a.found !== false);
    const vgcMembers = audit.filter(a => a.belongs_to_vgc_towers && a.found !== false);
    const ethanHomeMembers = audit.filter(a => a.belongs_to_ethan_family_home && a.found !== false);

    return Response.json({
      vgc_towers_id: vgcTowers?.id,
      ethan_family_home_id: ethanHome?.id,
      audit,
      summary: {
        total_audited: targetNames.length,
        found_count: audit.filter(a => a.found !== false).length,
        incorrectly_at_vgc: incorrectMembers.map(a => a.name),
        actually_vgc_residents: vgcMembers.map(a => a.name),
        actually_ethan_home: ethanHomeMembers.map(a => a.name),
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});