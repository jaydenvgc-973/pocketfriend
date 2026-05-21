/**
 * processLandlordRentPayment
 *
 * Landlord comes from LocationReference in-world owner/landlord fields, not owner_email.
 * If character/user is assigned as landlord, rent deposits into their financial account.
 * Integrates with existing financial system.
 *
 * Called by processRecurringExpenses or housing cost automation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      location_id,
      tenant_character_id,
      tenant_email,
      rent_amount,
      period_month,
      period_year,
      owner_email,
    } = await req.json();

    // Load location to get landlord info
    const location = await base44.entities.LocationReference.filter({ id: location_id }).catch(() => []);
    if (!location.length) {
      return Response.json({ error: 'Location not found' }, { status: 404 });
    }
    const loc = location[0];

    // Get landlord identifier from location
    // This could be owner_character_id or owner_character_name
    const landlordCharacterId = loc.owner_character_id;
    const landlordCharacterName = loc.owner_character_name;
    const landlordName = loc.owner_npc_name || landlordCharacterName || 'Landlord';

    if (!landlordCharacterId && !landlordCharacterName) {
      return Response.json({
        success: false,
        error: 'Location has no landlord assigned',
        location_id,
        location_name: loc.name,
      });
    }

    // Record rent transaction for tenant
    const tenantTransaction = await base44.entities.FinancialTransaction.create({
      character_id: tenant_character_id,
      character_name: 'Unknown', // Will be fetched separately if needed
      sender_id: tenant_character_id,
      sender_type: 'character',
      sender_name: 'Self',
      receiver_id: landlordCharacterId || 'npc_' + landlordCharacterName,
      receiver_type: landlordCharacterId ? 'character' : 'npc',
      receiver_name: landlordName,
      amount: rent_amount,
      direction: 'expense',
      transaction_type: 'rent',
      description: `Monthly rent for ${loc.name}`,
      location_id,
      location_name: loc.name,
      balance_after: 0, // Will be updated by financial system
      timestamp: new Date().toISOString(),
    });

    // If landlord is a character, credit their account
    if (landlordCharacterId) {
      const landlordTransaction = await base44.entities.FinancialTransaction.create({
        character_id: landlordCharacterId,
        character_name: landlordCharacterName,
        sender_id: tenant_character_id,
        sender_type: 'character',
        sender_name: 'Tenant',
        receiver_id: landlordCharacterId,
        receiver_type: 'character',
        receiver_name: landlordCharacterName,
        amount: rent_amount,
        direction: 'income',
        transaction_type: 'rent',
        description: `Rent received from ${loc.name}`,
        location_id,
        location_name: loc.name,
        balance_after: 0,
        timestamp: new Date().toISOString(),
      });

      console.log(`[processLandlordRentPayment] rent_paid | tenant=${tenant_character_id} | landlord=${landlordCharacterId} | amount=${rent_amount} | location=${location_id}`);
    } else {
      console.log(`[processLandlordRentPayment] rent_recorded_npc | tenant=${tenant_character_id} | landlord_npc=${landlordName} | amount=${rent_amount} | location=${location_id}`);
    }

    return Response.json({
      success: true,
      tenant_transaction_id: tenantTransaction.id,
      landlord_transaction_id: landlordCharacterId ? null : null,
      landlord_character_id: landlordCharacterId,
      landlord_name: landlordName,
      amount: rent_amount,
      location_id,
      location_name: loc.name,
    });

  } catch (error) {
    console.error('[processLandlordRentPayment]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});