import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch active_created_character records only
    const allChars = await base44.entities.Character.filter(
      { 
        created_by: user.email,
        character_type: 'active_created_character',
        status: 'active'
      },
      '-created_date',
      500
    );

    // Fetch all locations scoped to this user
    const allLocations = await base44.entities.LocationReference.filter(
      { owner_email: user.email },
      '-created_date',
      500
    );

    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    // Build diagnostic for each character
    const diagnostics = allChars.map(char => {
      const homeFromField = char.current_home_location_id || char.home_location_id || char.residence_id || null;
      const homeFromFieldName = homeFromField ? locationMap[homeFromField]?.name : null;

      // Scan location resident lists
      let homeFromLocationPage = null;
      let homeFromLocationPageName = null;
      for (const loc of allLocations) {
        if (loc.category !== 'home' && loc.category !== 'generic') continue;
        const inResidents = (loc.resident_character_ids || []).includes(char.id);
        const inResidentsArr = (loc.residents || []).some(r => r.character_id === char.id);
        if (inResidents || inResidentsArr) {
          homeFromLocationPage = loc.id;
          homeFromLocationPageName = loc.name;
          break;
        }
      }

      const agrees = homeFromField === homeFromLocationPage;

      return {
        characterName: char.name || 'Unknown',
        characterId: char.id,
        ownerEmail: char.owner_email || user.email,
        profileHomeField: {
          value: homeFromField,
          locationName: homeFromFieldName,
          source: 'current_home_location_id / home_location_id / residence_id'
        },
        locationPageResident: {
          value: homeFromLocationPage,
          locationName: homeFromLocationPageName,
          source: 'resident_character_ids / residents[] array'
        },
        agreementStatus: agrees ? 'MATCH' : 'CONFLICT',
        issue: !homeFromField && !homeFromLocationPage 
          ? 'NO HOME FOUND IN ANY PATH'
          : agrees 
          ? 'OK' 
          : 'FIELD MISMATCH: Different homes in different paths'
      };
    });

    // Group by issue type
    const summary = {
      totalActiveCharacters: allChars.length,
      withHomeInBothPaths: diagnostics.filter(d => d.agreementStatus === 'MATCH' && d.profileHomeField.value).length,
      withConflict: diagnostics.filter(d => d.agreementStatus === 'CONFLICT').length,
      withoutAnyHome: diagnostics.filter(d => d.issue === 'NO HOME FOUND IN ANY PATH').length,
    };

    return Response.json({
      summary,
      diagnostics,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[diagnosticHomeResolution]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});