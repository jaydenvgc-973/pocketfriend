import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processHousingCosts
 *
 * Charges active_created_character tenants for monthly rent + utilities at their residential locations.
 *
 * RESIDENTIAL RENT ONLY — this function handles homes, not business operating costs.
 * Business operating costs are handled by processLocationOperatingCosts.
 *
 * Rent credit rules (separated from business finance):
 *   - Owner (character) exists and is not NPC → credit that character's financial account
 *   - Owner is NPC → skip credit, log it (NPC financial system not supported)
 *   - No owner assigned → credit the authenticated user's balance, labeled as "rental income (no owner)"
 *
 * Idempotency:
 *   - billing_period key = "YYYY-MM" (monthly)
 *   - Before charging, checks the most recent rent transaction for this character+location
 *   - If a rent transaction already exists for the current billing_period, skip (no double charge)
 *
 * Trigger: scheduled automation or manual admin call. NEVER called on page load.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { backdated = false, dry_run = false } = await req.json().catch(() => ({}));
    const results = [];
    const paymentDate = new Date();
    if (backdated) {
      paymentDate.setDate(paymentDate.getDate() - 1);
    }

    // billing_period = "YYYY-MM" — idempotency key
    const billingPeriod = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;

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

      const homeLocations = await base44.entities.LocationReference.filter({
        resident_character_ids: char.id
      });

      if (homeLocations.length === 0) continue;
      const home = homeLocations[0];

      // Only charge rent if the location has an explicit configured cost.
      // NEVER default to a fabricated amount.
      if (!home.rent_or_housing_cost || home.rent_or_housing_cost <= 0) continue;

      // ── IDEMPOTENCY CHECK: skip if already charged this billing period ──────
      const recentRentTxns = await base44.entities.FinancialTransaction.filter({
        character_id: char.id,
        transaction_type: 'rent',
        location_id: home.id,
      }, '-timestamp', 5).catch(() => []);

      const alreadyCharged = recentRentTxns.some(txn => {
        if (!txn.timestamp) return false;
        const txnPeriod = txn.timestamp.substring(0, 7); // "YYYY-MM"
        return txnPeriod === billingPeriod && txn.description?.includes('Rent —');
      });

      if (alreadyCharged) {
        results.push({
          character_id: char.id,
          name: char.name,
          home: home.name,
          status: 'skipped_already_charged',
          billing_period: billingPeriod,
          reason: `Rent already charged for ${billingPeriod}`,
        });
        continue;
      }

      let rentCost = home.rent_or_housing_cost;
      let utilityCost = 0;

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
      const newBalance = Math.round((financial.current_balance - totalCost) * 100) / 100;

      if (dry_run) {
        results.push({
          character_id: char.id,
          name: char.name,
          home: home.name,
          rent: rentCost,
          utilities: utilityCost,
          total: totalCost,
          billing_period: billingPeriod,
          status: 'dry_run',
        });
        continue;
      }

      // ── RESIDENTIAL RENT CREDIT ──────────────────────────────────────────────
      // Rules: owner character → credit them | NPC owner → skip | no owner → credit user as rental income
      // This is RESIDENTIAL ONLY. Business operating costs are in processLocationOperatingCosts.
      const ownerCharId = home.owner_character_id || null;
      const ownerIsNpc = home.owner_is_npc === true;

      if (rentCost > 0) {
        if (ownerCharId && !ownerIsNpc) {
          // Credit the residential owner character
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
              description: `Rental income — ${home.name} | tenant: ${char.name} | period: ${billingPeriod}`,
              location_id: home.id,
              location_name: home.name,
              balance_after: ownerNewBalance,
              timestamp: paymentDate.toISOString(),
            }).catch(err => console.warn('[processHousingCosts] owner rent income txn failed:', err.message));
          }
        } else if (ownerIsNpc) {
          // NPC owner — skip credit, NPC finances not supported
          console.log(`[processHousingCosts] NPC owner for ${home.name} — rent credit skipped`);
        } else {
          // No owner assigned — credit the user account as labeled rental income
          const userSettings = await base44.entities.UserSettings.filter({
            owner_email: user.email
          }).catch(() => []);
          if (userSettings[0] && userSettings[0].user_balance !== undefined) {
            const us = userSettings[0];
            await base44.entities.UserSettings.update(us.id, {
              user_balance: Math.round((us.user_balance + rentCost) * 100) / 100,
            }).catch(err => console.warn('[processHousingCosts] user balance rental income update failed:', err.message));
            console.log(`[processHousingCosts] Rental income (no owner) +$${rentCost} → user account | location: ${home.name} | period: ${billingPeriod}`);
          }
        }
      }

      // ── Charge tenant ────────────────────────────────────────────────────────
      const updatedExpenses = financial.recurring_expenses || [];
      await base44.entities.CharacterFinancial.update(financial.id, {
        current_balance: newBalance,
        total_expenses: Math.round((financial.total_expenses + totalCost) * 100) / 100,
        recurring_expenses: [
          ...updatedExpenses.filter(e => e.expense_type !== 'rent' && e.expense_type !== 'utilities'),
          {
            expense_type: 'rent',
            location_id: home.id,
            location_name: home.name,
            monthly_cost: rentCost,
            total_paid: (updatedExpenses.find(e => e.expense_type === 'rent')?.total_paid || 0) + rentCost,
            last_payment_date: paymentDate.toISOString(),
          },
          {
            expense_type: 'utilities',
            location_id: home.id,
            location_name: home.name,
            monthly_cost: utilityCost,
            total_paid: (updatedExpenses.find(e => e.expense_type === 'utilities')?.total_paid || 0) + utilityCost,
            last_payment_date: paymentDate.toISOString(),
          },
        ],
      });

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
          description: `Rent — ${home.name} | period: ${billingPeriod}`,
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
          description: `Utilities — ${home.name} | period: ${billingPeriod}`,
          location_id: home.id,
          location_name: home.name,
          balance_after: Math.round((newBalance + (rentCost > 0 ? rentCost : 0) - utilityCost) * 100) / 100,
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
        billing_period: billingPeriod,
        payment_date: paymentDate.toISOString(),
        status: 'success',
      });
    }

    return Response.json({ success: true, housing: results, processed: results.length, billing_period: billingPeriod });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});