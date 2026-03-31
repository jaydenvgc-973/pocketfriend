import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const diagnostics = [];

    // ── PHASE 1: Check all characters ──────────────────────────────────────
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      500
    );
    diagnostics.push({
      phase: 'CHARACTERS',
      totalCharacters: allChars.length,
      activeCharacters: allChars.filter(c => c.status === 'active').length,
      characterIds: allChars.map(c => ({ id: c.id, name: c.name, status: c.status })),
    });

    // ── PHASE 2: Check all locations ───────────────────────────────────────
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email },
      '-created_date',
      500
    );
    diagnostics.push({
      phase: 'LOCATIONS_OVERALL',
      totalLocations: allLocations.length,
      locations: allLocations.map(l => ({
        id: l.id,
        name: l.name,
        isGeneric: l.is_default_generic,
        locationType: l.location_type,
        residents: l.resident_character_ids?.length || 0,
        zones: l.zones?.length || 0,
        images: (l.zones || []).reduce((sum, z) => sum + (z.image_urls?.length || 0), 0),
      })),
    });

    // ── PHASE 3: Check financial records ───────────────────────────────────
    const allFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { created_by: user.email },
      '-created_date',
      500
    );
    diagnostics.push({
      phase: 'FINANCIAL_RECORDS',
      totalFinancialRecords: allFinancial.length,
      financialByCharacter: allFinancial.map(f => ({
        characterId: f.character_id,
        characterName: f.character_name,
        homeLocationId: f.home_location_id,
        homeLocationName: f.home_location_name,
        isHomeless: f.is_homeless,
      })),
    });

    // ── PHASE 4: Cross-check: characters with AND without homes ─────────────
    const charactersWithHomes = new Set(allFinancial.map(f => f.character_id));
    const charactersWithoutHomes = allChars.filter(c => !charactersWithHomes.has(c.id));
    diagnostics.push({
      phase: 'CHARACTER_HOME_MAPPING',
      charactersWithFinancialRecords: charactersWithHomes.size,
      charactersWithoutFinancialRecords: charactersWithoutHomes.length,
      withoutHomesDetails: charactersWithoutHomes.map(c => ({
        id: c.id,
        name: c.name,
        createdDate: c.created_date,
      })),
    });

    // ── PHASE 5: Generic homes analysis ──────────────────────────────────
    const genericHomes = allLocations.filter(l => l.is_default_generic);
    diagnostics.push({
      phase: 'GENERIC_HOMES_ANALYSIS',
      totalGenericHomes: genericHomes.length,
      genericHomes: genericHomes.map(h => ({
        id: h.id,
        name: h.name,
        residents: h.resident_character_ids || [],
        residentCount: (h.resident_character_ids || []).length,
      })),
    });

    // ── PHASE 6: Orphaned locations (no residents, not generic) ──────────────
    const orphanedLocations = allLocations.filter(
      l => !l.is_default_generic && (!l.resident_character_ids || l.resident_character_ids.length === 0)
    );
    diagnostics.push({
      phase: 'ORPHANED_LOCATIONS',
      count: orphanedLocations.length,
      locations: orphanedLocations.map(l => ({
        id: l.id,
        name: l.name,
        locationType: l.location_type,
      })),
    });

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      userId: user.email,
      diagnostics,
      summary: {
        totalCharacters: allChars.length,
        totalLocations: allLocations.length,
        totalFinancialRecords: allFinancial.length,
        charactersWithoutHomes: charactersWithoutHomes.length,
        genericHomesFound: genericHomes.length,
      },
    });
  } catch (error) {
    console.error('[diagnosticGenericHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});