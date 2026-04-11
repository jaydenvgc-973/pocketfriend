import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, businessId, amount, isRetroactive } = await req.json();

    if (!characterId || !businessId || amount === undefined) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const char = await base44.asServiceRole.entities.Character.get(characterId);
    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Fetch character financial
    const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId });
    let financial = financialRecs[0];

    if (!financial) {
      const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: characterId }, null, 1);
      let startingBalance = 6000;
      if (transactions.length > 0) {
        const allTxns = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: characterId }, null, 500);
        startingBalance = 6000;
        for (const tx of allTxns) {
          if (tx.direction === 'income') startingBalance += tx.amount || 0;
          else if (tx.direction === 'expense') startingBalance -= tx.amount || 0;
        }
      }
      financial = await base44.asServiceRole.entities.CharacterFinancial.create({
        character_id: characterId,
        character_name: char.name,
        current_balance: Math.max(0, startingBalance),
      });
    }

    // Process payment
    const newBalance = (financial.current_balance || 6000) + parseFloat(amount);
    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      total_income: (financial.total_income || 0) + parseFloat(amount),
    });

    // Create transaction
    const now = new Date();
    const paymentDate = isRetroactive ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
    
    const business = (char.businesses || []).find(b => b.id === businessId);
    const businessName = business?.name || 'Custom Business';

    await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: char.name,
      sender_id: 'business_system',
      sender_type: 'system',
      sender_name: businessName,
      receiver_id: characterId,
      receiver_type: 'character',
      receiver_name: char.name,
      amount: parseFloat(amount),
      direction: 'income',
      transaction_type: 'income',
      description: `Weekly payment from ${businessName}${isRetroactive ? ' (retroactive)' : ''}`,
      timestamp: paymentDate.toISOString(),
      balance_after: newBalance,
    });

    // Schedule next Friday payment
    const nextFriday = getNextFriday();
    await base44.asServiceRole.entities.ScheduledEvent.create({
      character_ids: [characterId],
      character_names: [char.name],
      description: `Weekly payment of $${parseFloat(amount).toFixed(2)} from ${businessName}`,
      trigger_time: nextFriday.toISOString(),
      type: 'internal',
      source: 'system',
      primary_character_id: characterId,
    }).catch(() => null); // Silently fail if scheduling not available

    return Response.json({
      success: true,
      characterId,
      businessId,
      amount: parseFloat(amount),
      newBalance,
      isRetroactive,
    });
  } catch (error) {
    console.error('[processBusinessWorkerPayment]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getNextFriday() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
  const nextFriday = new Date(now.getTime() + daysUntilFriday * 24 * 60 * 60 * 1000);
  nextFriday.setHours(9, 0, 0, 0); // 9 AM
  return nextFriday;
}