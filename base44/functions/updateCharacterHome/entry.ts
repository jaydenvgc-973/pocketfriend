import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName, newLocationId, newLocationName, makeHomeless } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Get character's current financial record
    const financialRecords = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    );
    if (financialRecords.length === 0) {
      return Response.json({ error: 'Financial record not found' }, { status: 404 });
    }

    const financial = financialRecords[0];
    const oldHomeId = financial.home_location_id;

    if (makeHomeless) {
      // Mark as homeless
      await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
        home_location_id: null,
        home_location_name: null,
        is_homeless: true,
        expense_sources: [],
      });

      // Remove from old location's residents
      if (oldHomeId) {
        const oldHome = await base44.asServiceRole.entities.LocationReference.get(oldHomeId);
        if (oldHome) {
          const updatedResidents = (oldHome.resident_character_ids || []).filter(id => id !== characterId);
          const updatedNames = (oldHome.resident_character_names || []).filter(name => name !== characterName);
          await base44.asServiceRole.entities.LocationReference.update(oldHomeId, {
            resident_character_ids: updatedResidents,
            resident_character_names: updatedNames,
          });
        }
      }

      return Response.json({
        success: true,
        message: `${characterName} is now homeless`,
      });
    } else if (newLocationId && newLocationName) {
      // Move to new home
      const newHome = await base44.asServiceRole.entities.LocationReference.get(newLocationId);
      if (!newHome) return Response.json({ error: 'New location not found' }, { status: 404 });

      // Add to new location's residents
      const newResidents = Array.from(new Set([
        ...(newHome.resident_character_ids || []),
        characterId,
      ]));
      const newResidentNames = Array.from(new Set([
        ...(newHome.resident_character_names || []),
        characterName,
      ]));

      await base44.asServiceRole.entities.LocationReference.update(newLocationId, {
        resident_character_ids: newResidents,
        resident_character_names: newResidentNames,
      });

      // Remove from old location's residents
      if (oldHomeId && oldHomeId !== newLocationId) {
        const oldHome = await base44.asServiceRole.entities.LocationReference.get(oldHomeId);
        if (oldHome) {
          const updatedResidents = (oldHome.resident_character_ids || []).filter(id => id !== characterId);
          const updatedNames = (oldHome.resident_character_names || []).filter(name => name !== characterName);
          await base44.asServiceRole.entities.LocationReference.update(oldHomeId, {
            resident_character_ids: updatedResidents,
            resident_character_names: updatedNames,
          });
        }
      }

      // Update financial record
      const rentCost = newHome.rent_or_housing_cost || 1200;
      const utilitiesCost = Object.values(newHome.utility_costs || {}).reduce((a, b) => a + b, 0);

      const updatedExpenseSources = [
        {
          location_id: newLocationId,
          location_name: newLocationName,
          expense_type: 'rent',
          total_paid: 0,
          monthly_cost: rentCost,
          last_payment_date: null,
        },
        {
          location_id: newLocationId,
          location_name: newLocationName,
          expense_type: 'utilities',
          total_paid: 0,
          monthly_cost: utilitiesCost,
          last_payment_date: null,
        },
      ];

      await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
        home_location_id: newLocationId,
        home_location_name: newLocationName,
        is_homeless: false,
        expense_sources: updatedExpenseSources,
      });

      return Response.json({
        success: true,
        message: `${characterName} moved to ${newLocationName}`,
      });
    } else {
      return Response.json({
        error: 'Must provide either newLocationId or makeHomeless=true',
      }, { status: 400 });
    }
  } catch (error) {
    console.error('[updateCharacterHome]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});