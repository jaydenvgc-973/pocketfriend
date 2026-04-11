import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, businessId, amount, type, workerIds } = await req.json();

    if (!characterId || !businessId || !amount) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get character financial record
    let financial = (await base44.entities.CharacterFinancial.filter({ character_id: characterId }))[0];
    if (!financial) {
      const char = await base44.entities.Character.get(characterId);
      financial = await base44.entities.CharacterFinancial.create({
        character_id: characterId,
        character_name: char.name,
        current_balance: 6000,
        total_income: 0,
        total_expenses: 0,
      });
    }

    const newBalance = financial.current_balance + amount;

    // Update financial record
    await base44.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      total_income: financial.total_income + amount,
    });

    // Create transaction
    const txnDescription = type === 'revenue' 
      ? `Business revenue from ${businessId}`
      : `Worker payment for ${businessId}`;

    await base44.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: (await base44.entities.Character.get(characterId)).name,
      sender_id: 'system',
      sender_type: 'system',
      sender_name: 'Business System',
      receiver_id: characterId,
      receiver_type: 'character',
      receiver_name: (await base44.entities.Character.get(characterId)).name,
      amount,
      direction: 'income',
      transaction_type: type === 'revenue' ? 'income' : 'payroll',
      description: txnDescription,
      balance_after: newBalance,
      timestamp: new Date().toISOString(),
    });

    // TODO: Setup scheduled automations for recurring payments (monthly revenue on 1st, weekly worker pay on Fridays)
    // This will be implemented via the dashboard automations feature

    return Response.json({
      success: true,
      newBalance,
      message: `Payment processed. Balance updated to $${newBalance.toFixed(2)}`,
    });
  } catch (error) {
    console.error('Payment processing error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});