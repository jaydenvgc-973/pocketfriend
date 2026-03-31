import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all characters created by this user
    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      500
    );

    let processedCount = 0;
    const results = [];

    for (const character of allCharacters) {
      // Check if character already has a financial record
      const existingFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter(
        { character_id: character.id }
      );

      if (existingFinancial.length > 0) {
        results.push({ characterId: character.id, status: 'already_has_home' });
        continue;
      }

      // Create per-character generic home with full location fields
      const homeLocation = await base44.asServiceRole.entities.LocationReference.create({
        name: `Home - ${character.name}`,
        location_type: 'global',
        category: 'home',
        description: `Residential home for ${character.name}`,
        is_default_generic: true,
        generic_type: 'apartment',
        resident_character_ids: [character.id],
        resident_character_names: [character.name],
        zones: [
          { zone_name: 'Living Room', image_urls: [] },
          { zone_name: 'Bedroom', image_urls: [] },
          { zone_name: 'Kitchen', image_urls: [] },
          { zone_name: 'Bathroom', image_urls: [] },
        ],
        rent_or_housing_cost: 1200,
        utility_costs: {
          electricity: 80,
          water: 40,
          gas: 50,
          internet: 60,
          other: 0,
        },
      });

      console.log(`[BACKFILL] Created home for ${character.name}: ${homeLocation.id}`);

      // Create financial record
      const financial = await base44.asServiceRole.entities.CharacterFinancial.create({
        character_id: character.id,
        character_name: character.name,
        home_location_id: homeLocation.id,
        home_location_name: homeLocation.name,
        is_homeless: false,
        total_income: 0,
        total_expenses: 0,
        current_balance: 0,
        income_sources: [],
        expense_sources: [
          {
            location_id: homeLocation.id,
            location_name: homeLocation.name,
            expense_type: 'rent',
            total_paid: 0,
            monthly_cost: homeLocation.rent_or_housing_cost || 1200,
            last_payment_date: null,
          },
          {
            location_id: homeLocation.id,
            location_name: homeLocation.name,
            expense_type: 'utilities',
            total_paid: 0,
            monthly_cost: Object.values(homeLocation.utility_costs || {}).reduce((a, b) => a + b, 0),
            last_payment_date: null,
          },
        ],
        last_updated: new Date().toISOString(),
      });

      results.push({
        characterId: character.id,
        characterName: character.name,
        homeLocationId: homeLocation.id,
        homeLocationName: homeLocation.name,
        status: 'success',
      });

      processedCount++;
    }

    console.log(`[BACKFILL] Summary: Created ${results.filter(r => r.status === 'success').length} homes | Already assigned ${results.filter(r => r.status === 'already_has_home').length} | Total characters: ${allCharacters.length}`);

    return Response.json({
      success: true,
      processedCount,
      totalCharacters: allCharacters.length,
      createdCount: results.filter(r => r.status === 'success').length,
      alreadyAssignedCount: results.filter(r => r.status === 'already_has_home').length,
      results,
    });
  } catch (error) {
    console.error('[backfillGenericHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});