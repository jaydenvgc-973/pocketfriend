/**
 * processLandlordRentIncome
 *
 * Credits rent income to character landlords/property owners for all locations
 * they own that have active tenants/residents paying rent.
 *
 * This is SEPARATE from processHousingCosts (which charges tenants).
 * This function credits the OWNER of each location.
 *
 * Rules:
 *  - Source of truth: LocationReference.owner_character_id + resident_character_ids
 *  - Only credits when rent_or_housing_cost > 0
 *  - Idempotent per billing_period ("YYYY-MM")
 *  - Scoped by owner_email — no cross-account writes
 *  - Does NOT use created_by
 *  - Works for ANY landlord character, not hardcoded names/IDs
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = false, backdated = false } = await req.json().catch(() => ({}));
    const paymentDate = new Date();
    if (backdated) paymentDate.setDate(paymentDate.getDate() - 1);
    const billingPeriod = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;

    const results = [];
    const skipped = [];

    // Fetch all locations owned by any character on this account
    // We look for locations where owner_character_id is set AND owner_email matches
    // OR where created_by is the user (for legacy records — read-only, not used for writes)
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: user.email }
    ).catch(() => []);

    // Collect locations that have an owner character AND active tenants paying rent
    const landlordLocations = allLocations.filter(loc =>
      loc.owner_character_id &&
      loc.rent_or_housing_cost > 0 &&
      (loc.resident_character_ids || []).length > 0
    );

    console.log(`[processLandlordRentIncome] Found ${landlordLocations.length} locations with owner + rent + residents | owner_email=${user.email}`);

    for (const loc of landlordLocations) {
      const ownerCharId = loc.owner_character_id;
      const ownerCharName = loc.owner_character_name || ownerCharId;

      // Skip NPC owners — NPC financial system is not supported
      if (loc.owner_is_npc === true) {
        skipped.push({ location: loc.name, reason: 'npc_owner_skipped' });
        continue;
      }

      // Get owner's financial record
      const ownerFinList = await base44.asServiceRole.entities.CharacterFinancial.filter({
        character_id: ownerCharId
      }).catch(() => []);

      if (!ownerFinList[0]) {
        skipped.push({ location: loc.name, owner: ownerCharName, reason: 'no_financial_record' });
        continue;
      }
      const ownerFin = ownerFinList[0];

      // Idempotency: check if we already credited this owner for this location this period
      const recentIncome = await base44.asServiceRole.entities.FinancialTransaction.filter({
        character_id: ownerCharId,
        transaction_type: 'rent',
        location_id: loc.id,
        direction: 'income',
      }, '-timestamp', 5).catch(() => []);

      const alreadyCredited = recentIncome.some(txn => {
        if (!txn.timestamp) return false;
        const txnPeriod = txn.timestamp.substring(0, 7);
        return txnPeriod === billingPeriod && txn.description?.includes('Rental income');
      });

      if (alreadyCredited) {
        skipped.push({
          location: loc.name,
          owner: ownerCharName,
          reason: `already_credited_${billingPeriod}`,
        });
        continue;
      }

      // Calculate total rent from all paying residents
      const residents = loc.resident_character_ids || [];
      const residentCount = residents.length;
      if (residentCount === 0) {
        skipped.push({ location: loc.name, owner: ownerCharName, reason: 'no_residents' });
        continue;
      }

      // Total rent = full location rent (owner receives sum from all tenants)
      const totalRent = loc.rent_or_housing_cost;

      if (dry_run) {
        results.push({
          location_id: loc.id,
          location: loc.name,
          owner_character_id: ownerCharId,
          owner: ownerCharName,
          rent_income: totalRent,
          resident_count: residentCount,
          billing_period: billingPeriod,
          status: 'dry_run',
        });
        continue;
      }

      const ownerNewBalance = Math.round((ownerFin.current_balance + totalRent) * 100) / 100;
      const ownerNewIncome = Math.round((ownerFin.total_income + totalRent) * 100) / 100;

      // Update owner's CharacterFinancial balance
      await base44.asServiceRole.entities.CharacterFinancial.update(ownerFin.id, {
        current_balance: ownerNewBalance,
        total_income: ownerNewIncome,
      }).catch(err => console.warn(`[processLandlordRentIncome] balance update failed for ${ownerCharName}: ${err.message}`));

      // Write income transaction
      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: ownerCharId,
        character_name: ownerCharName,
        sender_id: null,
        sender_type: 'system',
        sender_name: 'Rental Income',
        receiver_id: ownerCharId,
        receiver_type: 'character',
        receiver_name: ownerCharName,
        amount: totalRent,
        direction: 'income',
        transaction_type: 'rent',
        description: `Rental income — ${loc.name} | ${residentCount} tenant(s) | period: ${billingPeriod}`,
        location_id: loc.id,
        location_name: loc.name,
        balance_after: ownerNewBalance,
        timestamp: paymentDate.toISOString(),
      }).catch(err => console.warn(`[processLandlordRentIncome] txn write failed for ${ownerCharName}: ${err.message}`));

      console.log(`[processLandlordRentIncome] ✅ Credited $${totalRent} → ${ownerCharName} for ${loc.name} (${residentCount} tenants) | period=${billingPeriod}`);

      results.push({
        location_id: loc.id,
        location: loc.name,
        owner_character_id: ownerCharId,
        owner: ownerCharName,
        rent_income: totalRent,
        resident_count: residentCount,
        new_balance: ownerNewBalance,
        billing_period: billingPeriod,
        payment_date: paymentDate.toISOString(),
        status: 'success',
      });
    }

    return Response.json({
      success: true,
      credited: results.filter(r => r.status === 'success').length,
      dry_run_count: results.filter(r => r.status === 'dry_run').length,
      skipped: skipped.length,
      billing_period: billingPeriod,
      results,
      skipped_details: skipped,
    });

  } catch (error) {
    console.error('[processLandlordRentIncome] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});