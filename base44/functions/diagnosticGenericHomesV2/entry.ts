import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── Get ALL locations without filter to see everything ────────────────────
    const allLocationsUnfiltered = await base44.asServiceRole.entities.LocationReference.list(
      '-created_date',
      500
    );

    // ── Get locations filtered by created_by ──────────────────────────────────
    const allLocationsFiltered = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email },
      '-created_date',
      500
    );

    // ── Get all characters ────────────────────────────────────────────────────
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-created_date',
      500
    );

    // ── Get all financial records ─────────────────────────────────────────────
    const allFinancial = await base44.asServiceRole.entities.CharacterFinancial.list(
      '-created_date',
      500
    );

    return Response.json({
      success: true,
      diagnostics: {
        unfiltered_locations_count: allLocationsUnfiltered.length,
        filtered_by_created_by_count: allLocationsFiltered.length,
        characters_count: allChars.length,
        financial_records_count: allFinancial.length,
        unfiltered_locations: allLocationsUnfiltered.map(l => ({
          id: l.id,
          name: l.name,
          isGeneric: l.is_default_generic,
          createdBy: l.created_by,
          residents: (l.resident_character_ids || []).length,
        })),
        financial_by_character: allFinancial.slice(0, 20).map(f => ({
          characterId: f.character_id,
          characterName: f.character_name,
          homeLocationName: f.home_location_name,
        })),
      },
    });
  } catch (error) {
    console.error('[diagnosticGenericHomesV2]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});