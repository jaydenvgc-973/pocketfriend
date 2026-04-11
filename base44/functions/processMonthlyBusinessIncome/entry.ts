import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all active characters
    const allCharacters = await base44.entities.Character.filter({ status: 'active' });
    const results = {
      processed: 0,
      businesses: 0,
      failed: 0,
      details: []
    };

    for (const character of allCharacters) {
      try {
        // Collect all businesses (custom + location-based)
        const customBusinesses = character.businesses || [];
        const ownedLocations = await base44.entities.LocationReference.filter({ 
          owner_character_id: character.id 
        });

        const allBusinesses = [
          ...customBusinesses,
          ...ownedLocations.map(loc => ({
            id: loc.id,
            name: loc.name,
            income: loc.income_generated || 0,
            isLocationBased: true,
            linkedLocationId: loc.id
          }))
        ];

        // Process each business with income
        for (const business of allBusinesses) {
          if (!business.income || business.income === 0) continue;

          try {
            // Get or create financial record
            let financial = (await base44.entities.CharacterFinancial.filter({ 
              character_id: character.id 
            }))[0];

            if (!financial) {
              financial = await base44.entities.CharacterFinancial.create({
                character_id: character.id,
                character_name: character.name,
                current_balance: 6000,
                total_income: 0,
                total_expenses: 0,
              });
            }

            const newBalance = financial.current_balance + business.income;

            // Update financial record
            await base44.entities.CharacterFinancial.update(financial.id, {
              current_balance: newBalance,
              total_income: financial.total_income + business.income,
            });

            // Create transaction
            await base44.entities.FinancialTransaction.create({
              character_id: character.id,
              character_name: character.name,
              sender_id: 'system',
              sender_type: 'system',
              sender_name: 'Business System',
              receiver_id: character.id,
              receiver_type: 'character',
              receiver_name: character.name,
              amount: business.income,
              direction: 'income',
              transaction_type: 'income',
              description: `Monthly business income from ${business.name}`,
              balance_after: newBalance,
              timestamp: new Date().toISOString(),
            });

            results.businesses++;
            results.details.push({
              characterName: character.name,
              businessName: business.name,
              amount: business.income,
              newBalance: newBalance,
              status: 'success'
            });
          } catch (bizErr) {
            results.failed++;
            results.details.push({
              characterName: character.name,
              businessName: business.name,
              error: bizErr.message,
              status: 'failed'
            });
          }
        }

        if (allBusinesses.filter(b => b.income > 0).length > 0) {
          results.processed++;
        }
      } catch (charErr) {
        results.failed++;
        console.error(`Error processing character ${character.id}:`, charErr);
      }
    }

    return Response.json({
      success: true,
      ...results,
      message: `Processed ${results.processed} characters with ${results.businesses} business income payments`,
    });
  } catch (error) {
    console.error('Monthly business income error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});