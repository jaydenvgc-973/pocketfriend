import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get all active characters with businesses
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    let successCount = 0;
    let failureCount = 0;

    for (const char of allChars) {
      const businesses = char.businesses || [];
      
      // Process each business with worker pay configured
      for (const business of businesses) {
        if (!business.monthly_worker_pay || business.monthly_worker_pay === 0) continue;

        try {
          // Calculate weekly pay (monthly_worker_pay / 4.33 weeks)
          const weeklyAmount = business.monthly_worker_pay / 4.33;

          // Fetch or create financial record
          const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
          let financial = financialRecs[0];

          if (!financial) {
            const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: char.id }, null, 1);
            let startingBalance = 6000;
            if (transactions.length > 0) {
              const allTxns = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: char.id }, null, 500);
              startingBalance = 6000;
              for (const tx of allTxns) {
                if (tx.direction === 'income') startingBalance += tx.amount || 0;
                else if (tx.direction === 'expense') startingBalance -= tx.amount || 0;
              }
            }
            financial = await base44.asServiceRole.entities.CharacterFinancial.create({
              character_id: char.id,
              character_name: char.name,
              current_balance: Math.max(0, startingBalance),
            });
          }

          // Update balance
          const newBalance = (financial.current_balance || 6000) + weeklyAmount;
          await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
            current_balance: newBalance,
            total_income: (financial.total_income || 0) + weeklyAmount,
          });

          // Create transaction
          const now = new Date();
          await base44.asServiceRole.entities.FinancialTransaction.create({
            character_id: char.id,
            character_name: char.name,
            sender_id: 'business_system',
            sender_type: 'system',
            sender_name: business.name,
            receiver_id: char.id,
            receiver_type: 'character',
            receiver_name: char.name,
            amount: weeklyAmount,
            direction: 'income',
            transaction_type: 'income',
            description: `Weekly payment from ${business.name}`,
            timestamp: now.toISOString(),
            balance_after: newBalance,
          });

          successCount++;
        } catch (err) {
          console.error(`Failed to process payroll for ${char.name} - ${business.name}:`, err.message);
          failureCount++;
        }
      }
    }

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      processed: successCount,
      failed: failureCount,
    });
  } catch (error) {
    console.error('[processWeeklyBusinessPayroll]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});