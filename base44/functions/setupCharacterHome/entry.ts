import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName } = await req.json();
    if (!characterId || !characterName) {
      return Response.json({ error: 'characterId and characterName required' }, { status: 400 });
    }

    // Check if character already has a financial record
    const existingFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    );
    if (existingFinancial.length > 0) {
      return Response.json({ success: false, message: 'Financial record already exists' });
    }

    // Create or find a generic residential home for this character
    let homeLocation = null;
    
    // Look for existing default generic apartments
    const genericHomes = await base44.asServiceRole.entities.LocationReference.filter(
      { is_default_generic: true, generic_type: 'apartment', created_by: user.email }
    );

    if (genericHomes.length === 0) {
      // Create a new generic apartment
      homeLocation = await base44.asServiceRole.entities.LocationReference.create({
        name: `Generic Apartment #${Math.floor(Math.random() * 10000)}`,
        location_type: 'global',
        category: 'home',
        description: 'A comfortable generic apartment',
        is_default_generic: true,
        generic_type: 'apartment',
        resident_character_ids: [characterId],
        resident_character_names: [characterName],
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
      // Use the first generic home and add this character as a resident
      homeLocation = genericHomes[0];
      const updatedResidents = Array.from(new Set([
        ...(homeLocation.resident_character_ids || []),
        characterId,
      ]));
      const updatedResidentNames = Array.from(new Set([
        ...(homeLocation.resident_character_names || []),
        characterName,
      ]));
      
      homeLocation = await base44.asServiceRole.entities.LocationReference.update(
        homeLocation.id,
        {
          resident_character_ids: updatedResidents,
          resident_character_names: updatedResidentNames,
        }
      );
    }

    // Create financial record linked to the home
    const financialRecord = await base44.asServiceRole.entities.CharacterFinancial.create({
      character_id: characterId,
      character_name: characterName,
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

    return Response.json({
      success: true,
      home_location_id: homeLocation.id,
      home_location_name: homeLocation.name,
      financial_record_id: financialRecord.id,
    });
  } catch (error) {
    console.error('[setupCharacterHome]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});