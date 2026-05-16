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
      // ── ACTIVE CREATED CHARACTER GUARD ──────────────────────────────────
      const isActiveCreated =
        char.character_type === 'active_created_character' ||
        char.is_active_created_character === true ||
        char.is_active_character === true;
      if (!isActiveCreated) {
        console.log(`[processHousingCosts] SKIP ${char.name} (${char.character_type || 'no type'}) — not active_created_character`);
        continue;
      }

      const financials = await base44.entities.CharacterFinancial.filter({
        character_id: char.id
      });

      if (!financials[0]) continue;
      const financial = financials[0];

      // Get home location — only process if a real rent_or_housing_cost is configured.
      // Never fabricate rent for characters without a formal mapped home.
      {
        const homeLocations = await base44.entities.LocationReference.filter({
          resident_character_ids: char.id
        });

        if (homeLocations.length === 0) continue;
        const home = homeLocations[0];

        // Only charge rent if the location has an explicit configured cost.
        // NEVER default to a fabricated $1200 or any other arbitrary amount.
        if (!home.rent_or_housing_cost || home.rent_or_housing_cost <= 0) continue;

        let rentCost = home.rent_or_housing_cost;
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

        // ── RENT CREDIT: credit goes to the location owner (if one exists) ──
        // If no owner is assigned, credit the user account as rental income.
        // If owner is NPC, skip credit (NPC financial system not supported).
        const ownerCharId = home.owner_character_id || null;
        const ownerIsNpc = home.owner_is_npc === true;

        if (rentCost > 0) {
          if (ownerCharId && !ownerIsNpc) {
            // Credit the owner character's financial account
            const ownerFinancials = await base44.entities.CharacterFinancial.filter({
              character_id: ownerCharId
            }).catch(() => []);
            if (ownerFinancials[0]) {
              const ownerFin = ownerFinancials[0];
              const ownerNewBalance = Math.round((ownerFin.current_balance + rentCost) * 100) / 100;
              await base44.entities.CharacterFinancial.update(ownerFin.id, {
                current_balance: ownerNewBalance,
                total_income: Math.round((ownerFin.total_income + rentCost) * 100) / 100,
              }).catch(err => console.warn('[processHousingCosts] owner credit update failed:', err.message));
              await base44.entities.FinancialTransaction.create({
                character_id: ownerCharId,
                character_name: home.owner_character_name || ownerCharId,
                sender_id: char.id,
                sender_type: 'character',
                sender_name: char.name,
                receiver_id: ownerCharId,
                receiver_type: 'character',
                receiver_name: home.owner_character_name || ownerCharId,
                amount: rentCost,
                direction: 'income',
                transaction_type: 'rent',
                description: `Rental income — ${home.name} (tenant: ${char.name})`,
                location_id: home.id,
                location_name: home.name,
                balance_after: ownerNewBalance,
                timestamp: paymentDate.toISOString(),
              }).catch(err => console.warn('[processHousingCosts] owner rent income txn failed:', err.message));
            }
          } else if (!ownerCharId && !ownerIsNpc) {
            // No owner assigned — credit the authenticated user's balance as rental income
            const userSettings = await base44.entities.UserSettings.filter({
              owner_email: user.email
            }).catch(() => []);
            if (userSettings[0] && userSettings[0].user_balance !== undefined) {
              const us = userSettings[0];
              await base44.entities.UserSettings.update(us.id, {
                user_balance: Math.round((us.user_balance + rentCost) * 100) / 100,
              }).catch(err => console.warn('[processHousingCosts] user balance rental income update failed:', err.message));
              console.log(`[processHousingCosts] Rental income +$${rentCost} → user account (no owner assigned for ${home.name})`);
            }
          }
          // NPC owner: skip credit silently — NPC finances not supported
        }

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

        // Write FinancialTransaction so rent/utilities are visible in character awareness
        if (rentCost > 0) {
          await base44.entities.FinancialTransaction.create({
            character_id: char.id,
            character_name: char.name,
            sender_type: 'system',
            sender_name: 'Housing',
            receiver_type: 'character',
            receiver_name: char.name,
            amount: rentCost,
            direction: 'expense',
            transaction_type: 'rent',
            description: `Rent — ${home.name}`,
            location_id: home.id,
            location_name: home.name,
            balance_after: newBalance,
            timestamp: paymentDate.toISOString(),
          }).catch(err => console.warn('[processHousingCosts] rent txn write failed:', err.message));
        }
        if (utilityCost > 0) {
          await base44.entities.FinancialTransaction.create({
            character_id: char.id,
            character_name: char.name,
            sender_type: 'system',
            sender_name: 'Housing',
            receiver_type: 'character',
            receiver_name: char.name,
            amount: utilityCost,
            direction: 'expense',
            transaction_type: 'utilities',
            description: `Utilities — ${home.name}`,
            location_id: home.id,
            location_name: home.name,
            balance_after: newBalance - (rentCost > 0 ? 0 : 0),
            timestamp: paymentDate.toISOString(),
          }).catch(err => console.warn('[processHousingCosts] utilities txn write failed:', err.message));
        }

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