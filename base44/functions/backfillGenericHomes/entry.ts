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

      // Create or reuse a generic apartment for this character
      const genericHomes = await base44.asServiceRole.entities.LocationReference.filter(
        { is_default_generic: true, generic_type: 'apartment', created_by: user.email }
      );

      let homeLocation;
      if (genericHomes.length === 0) {
        // Create new generic apartment
        homeLocation = await base44.asServiceRole.entities.LocationReference.create({
          name: `Generic Apartment #${Math.floor(Math.random() * 10000)}`,
          location_type: 'global',
          category: 'home',
          description: 'A comfortable generic apartment',
          is_default_generic: true,
          generic_type: 'apartment',
          resident_character_ids: [character.id],
          resident_character_names: [character.name],
          rent_or_housing_cost: 1200,
          utility_costs: {
            electricity: 80,
            water: 40,
            gas: 50,
            internet: 60,
            other: 0,
          },
        });
      } else {
        // Add to existing generic apartment
        homeLocation = genericHomes[0];
        const updatedResidents = Array.from(new Set([
          ...(homeLocation.resident_character_ids || []),
          character.id,
        ]));
        const updatedResidentNames = Array.from(new Set([
          ...(homeLocation.resident_character_names || []),
          character.name,
        ]));

        homeLocation = await base44.asServiceRole.entities.LocationReference.update(
          homeLocation.id,
          {
            resident_character_ids: updatedResidents,
            resident_character_names: updatedResidentNames,
          }
        );
      }

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

    return Response.json({
      success: true,
      processedCount,
      totalCharacters: allCharacters.length,
      results,
    });
  } catch (error) {
    console.error('[backfillGenericHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});