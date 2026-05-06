import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = {
      totalCharacters: 0,
      homesCreated: 0,
      financialRecordsCreated: 0,
      skipped: 0,
      errors: [],
    };

    // Get all active characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, status: 'active' },
      '-created_date',
      500
    );
    results.totalCharacters = allChars.length;

    for (const char of allChars) {
      try {
        // Check if character already has a financial record (home)
        const existingFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: char.id,
        });

        if (existingFinancial.length > 0) {
          results.skipped++;
          continue;
        }

        // Create per-character generic home
        const homeLocation = await base44.asServiceRole.entities.LocationReference.create({
          name: `Home - ${char.name}`,
          location_type: 'global',
          category: 'home',
          description: `Residential home for ${char.name}`,
          is_default_generic: true,
          generic_type: 'apartment',
          resident_character_ids: [char.id],
          resident_character_names: [char.name],
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

        // Create financial record
        const financial = await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
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
              monthly_cost: 1200,
              last_payment_date: null,
            },
            {
              location_id: homeLocation.id,
              location_name: homeLocation.name,
              expense_type: 'utilities',
              total_paid: 0,
              monthly_cost: 230,
              last_payment_date: null,
            },
          ],
          last_updated: new Date().toISOString(),
        });

        results.homesCreated++;
        results.financialRecordsCreated++;

        console.log(`[BACKFILL] Created home for ${char.name}`);
      } catch (err) {
        results.errors.push({
          characterId: char.id,
          characterName: char.name,
          error: err.message,
        });
        console.error(`[BACKFILL] Error for ${char.name}:`, err.message);
      }
    }

    return Response.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('[backfillAllCharacterHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});