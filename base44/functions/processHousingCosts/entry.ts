import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { backdated = false } = await req.json().catch(() => ({}));
    const results = [];
    const paymentDate = new Date();
    if (backdated) {
      paymentDate.setDate(paymentDate.getDate() - 1); // Yesterday
    }

    // Get all characters
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const characters = await base44.entities.Character.filter({
      owner_email: user.email,
      status: 'active'
    });

    for (const char of characters) {
      const financials = await base44.entities.CharacterFinancial.filter({
        character_id: char.id
      });

      if (!financials[0]) continue;
      const financial = financials[0];

      // Get home location
      if (!char.occupation_location_id || char.occupation_location_id === char.occupation_location_id) {
        const homeLocations = await base44.entities.LocationReference.filter({
          resident_character_ids: char.id
        });

        if (homeLocations.length === 0) continue;
        const home = homeLocations[0];

        let rentCost = home.rent_or_housing_cost || 1200;
        let utilityCost = 0;

        // Calculate utilities
        if (home.utility_costs) {
          utilityCost = Object.values(home.utility_costs).reduce((sum, cost) => sum + (cost || 0), 0);
        }

        // Split costs if multiple residents
        const residentCount = (home.resident_character_ids || []).length;
        if (residentCount > 1) {
          if (home.cost_split_method === 'custom' && home.resident_cost_split && home.resident_cost_split[char.id]) {
            rentCost = home.resident_cost_split[char.id];
          } else {
            rentCost = Math.round((rentCost / residentCount) * 100) / 100;
            utilityCost = Math.round((utilityCost / residentCount) * 100) / 100;
          }
        }

        const totalCost = rentCost + utilityCost;
        const newBalance = financial.current_balance - totalCost;

        // Update financial record
        const updatedExpenses = financial.recurring_expenses || [];
        await base44.entities.CharacterFinancial.update(financial.id, {
          current_balance: Math.max(newBalance, newBalance), // Allow negative balance
          total_expenses: financial.total_expenses + totalCost,
          recurring_expenses: [
            ...updatedExpenses.filter(e => e.expense_type !== 'rent' && e.expense_type !== 'utilities'),
            {
              expense_type: 'rent',
              location_id: home.id,
              location_name: home.name,
              monthly_cost: rentCost,
              total_paid: (updatedExpenses.find(e => e.expense_type === 'rent')?.total_paid || 0) + rentCost,
              last_payment_date: paymentDate.toISOString()
            },
            {
              expense_type: 'utilities',
              location_id: home.id,
              location_name: home.name,
              monthly_cost: utilityCost,
              total_paid: (updatedExpenses.find(e => e.expense_type === 'utilities')?.total_paid || 0) + utilityCost,
              last_payment_date: paymentDate.toISOString()
            }
          ]
        });

        results.push({
          character_id: char.id,
          name: char.name,
          home: home.name,
          rent: rentCost,
          utilities: utilityCost,
          total: totalCost,
          new_balance: newBalance,
          payment_date: paymentDate.toISOString(),
          status: 'success'
        });
      }
    }

    return Response.json({ success: true, housing: results, processed: results.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});