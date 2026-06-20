import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const DAILY_FOOD_COST = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch ONLY active_created_character types — real food charges apply exclusively to them
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active_created_character' },
      null,
      1000
    );

    const today = new Date();
    const todayISOString = today.toISOString();
    let successCount = 0;
    let failureCount = 0;

    for (const char of allChars) {
      try {
        // Fetch or create CharacterFinancial
        const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
        let financial = financialRecs[0];
        
        if (!financial) {
          // Before creating with default, check if transactions exist
          const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: char.id }, null, 1);
          let startingBalance = 6000;
          if (transactions.length > 0) {
            // Recalculate from transactions
            const allTxns = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: char.id }, null, 500);
            startingBalance = 6000;
            for (const tx of allTxns) {
              if (tx.direction === 'income') {
                startingBalance += tx.amount || 0;
              } else if (tx.direction === 'expense') {
                startingBalance -= tx.amount || 0;
              }
            }
          }
          financial = await base44.asServiceRole.entities.CharacterFinancial.create({
            character_id: char.id,
            character_name: char.name,
            current_balance: Math.max(0, startingBalance),
          });
        }

        // Deduct daily food cost
        const newBalance = Math.max(0, (financial.current_balance || 6000) - DAILY_FOOD_COST);
        await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
          current_balance: newBalance,
          total_expenses: (financial.total_expenses || 0) + DAILY_FOOD_COST,
        });

        // Create transaction record
        await base44.asServiceRole.entities.FinancialTransaction.create({
          character_id: char.id,
          character_name: char.name,
          sender_id: 'system',
          sender_type: 'system',
          sender_name: 'System',
          receiver_id: char.id,
          receiver_type: 'character',
          receiver_name: char.name,
          amount: DAILY_FOOD_COST,
          direction: 'expense',
          transaction_type: 'groceries',
          description: `Daily food expense`,
          timestamp: todayISOString,
          balance_after: newBalance,
        });

        successCount++;
      } catch (err) {
        console.error(`[processDailyFoodCharges] Failed for ${char.name}:`, err.message);
        failureCount++;
      }
    }

    console.log(`[processDailyFoodCharges] Charged ${successCount} characters, ${failureCount} failures`);

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      charged: successCount,
      failed: failureCount,
    });
  } catch (error) {
    console.error('[processDailyFoodCharges]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});