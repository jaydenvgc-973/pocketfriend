import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Recalculate all expenses for a character based on their current home, jobs, and subscriptions.
 * Called monthly or when location/employment changes.
 * Returns updated expense list for the character profile display.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId } = body;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Get character and financial record
    const character = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
    const financial = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    ).then(arr => arr[0]);

    if (!financial) {
      return Response.json({ error: 'Financial record not found' }, { status: 404 });
    }

    // Get home location to calculate rent + utilities
    const homeLocation = financial.home_location_id
      ? await base44.asServiceRole.entities.LocationReference.get(financial.home_location_id).catch(() => null)
      : null;

    // Recalculate expenses
    const expenses = [];

    // ── RENT (active characters only) ──────────────────────────────────
    if (homeLocation && !financial.is_npc) {
      const activeResidents = (homeLocation.resident_character_ids || []).length;
      const activePaying = activeResidents > 0 ? activeResidents : 1;
      const rentPerPerson = (homeLocation.rent_or_housing_cost || 1200) / activePaying;

      expenses.push({
        expense_type: 'rent',
        location_id: homeLocation.id,
        location_name: homeLocation.name,
        monthly_cost: rentPerPerson,
      });

      // ── UTILITIES (split like rent) ──────────────────────────────────
      const utilTotal = Object.values(homeLocation.utility_costs || {}).reduce((a, b) => (a || 0) + (b || 0), 0) || 130;
      const utilPerPerson = utilTotal / activePaying;
      expenses.push({
        expense_type: 'utilities',
        location_id: homeLocation.id,
        location_name: homeLocation.name,
        monthly_cost: utilPerPerson,
      });

      // ── GROCERIES (based on household size) ──────────────────────────
      const householdSize = homeLocation.grocery_household_size || activeResidents || 1;
      const baseGrocerySpend = 300; // U.S. average baseline per person per month
      const groceryCost = baseGrocerySpend * householdSize;
      expenses.push({
        expense_type: 'groceries',
        location_id: homeLocation.id,
        location_name: homeLocation.name,
        monthly_cost: groceryCost / activeResidents,
      });
    }

    // ── GYM MEMBERSHIP ──────────────────────────────────────────────────
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    const gymLocs = allLocations.filter(
      l => l.category === 'gym' && (l.gym_members || []).includes(characterId)
    );
    for (const gym of gymLocs) {
      expenses.push({
        expense_type: 'gym',
        location_id: gym.id,
        location_name: gym.name,
        monthly_cost: gym.gym_membership_fee || 50,
      });
    }

    // ── PHONE / STREAMING / CUSTOM (preserved from existing) ────────────
    if (financial.recurring_expenses && Array.isArray(financial.recurring_expenses)) {
      const preserved = financial.recurring_expenses.filter(
        e => ['phone', 'streaming', 'custom'].includes(e.expense_type)
      );
      expenses.push(...preserved);
    }

    // Update financial record with new expenses
    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      recurring_expenses: expenses,
      last_updated: new Date().toISOString(),
    });

    // Calculate totals for display
    const monthlyTotal = expenses.reduce((sum, e) => sum + (e.monthly_cost || 0), 0);

    return Response.json({
      success: true,
      expenses,
      monthly_total: monthlyTotal,
    });
  } catch (error) {
    console.error('[calculateCharacterExpenses]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});