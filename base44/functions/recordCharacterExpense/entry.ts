import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { characterId, amount, transactionType, description, locationId, locationName } = body;

    if (!characterId || !amount || !transactionType || !description) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get character financial record
    const financialRecords = await base44.entities.CharacterFinancial.filter({
      character_id: characterId
    });

    if (!financialRecords || financialRecords.length === 0) {
      return Response.json({ error: 'Character financial record not found' }, { status: 404 });
    }

    const financial = financialRecords[0];
    const newBalance = financial.current_balance - amount;

    // Create transaction record
    const transaction = await base44.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: financial.character_name,
      sender_type: 'character',
      sender_name: financial.character_name,
      receiver_type: 'system',
      receiver_name: 'Vendor',
      amount,
      direction: 'expense',
      transaction_type: transactionType,
      description,
      location_id: locationId || null,
      location_name: locationName || null,
      balance_after: newBalance,
      timestamp: new Date().toISOString(),
    });

    // Update character financial record
    await base44.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      total_expenses: (financial.total_expenses || 0) + amount,
      last_updated: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      transactionId: transaction.id,
      newBalance,
    });
  } catch (error) {
    console.error('[recordCharacterExpense]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});