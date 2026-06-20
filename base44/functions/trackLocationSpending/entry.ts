import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Track spending at locations
 * Monitors when characters create transactions at locations and ensures
 * their financial balance is updated accordingly
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, amount, locationId, locationName, transactionType, description } = await req.json();

    if (!characterId || !amount || !transactionType) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get character financial record
    const financialRecords = await base44.asServiceRole.entities.CharacterFinancial.filter({
      character_id: characterId
    });

    if (!financialRecords || financialRecords.length === 0) {
      return Response.json({ error: 'No financial record found for character' }, { status: 404 });
    }

    const financial = financialRecords[0];
    const newBalance = financial.current_balance - amount;

    // Create transaction record
    const transaction = await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: financial.character_name,
      sender_type: 'character',
      sender_name: financial.character_name,
      receiver_type: 'system',
      receiver_name: 'Location',
      amount,
      direction: 'expense',
      transaction_type: transactionType,
      description: description || `Purchase at ${locationName || 'location'}`,
      location_id: locationId || null,
      location_name: locationName || null,
      balance_after: newBalance,
      timestamp: new Date().toISOString(),
    });

    // Update character financial balance
    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      total_expenses: (financial.total_expenses || 0) + amount,
      last_updated: new Date().toISOString(),
    });

    // Update character's current balance field if it exists
    const character = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
    if (character) {
      await base44.asServiceRole.entities.Character.update(characterId, {
        current_balance: newBalance,
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      transactionId: transaction.id,
      newBalance,
      amountSpent: amount,
    });
  } catch (error) {
    console.error('[trackLocationSpending]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});