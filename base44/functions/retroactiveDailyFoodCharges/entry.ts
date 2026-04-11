import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const DAILY_FOOD_COST = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all active created characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const today = new Date('2026-04-11');
    let totalChargesCreated = 0;
    let successCount = 0;
    let failureCount = 0;

    for (const char of allChars) {
      try {
        const createdDate = new Date(char.created_date);
        
        // Fetch or create CharacterFinancial
        const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
        let financial = financialRecs[0];
        
        if (!financial) {
          financial = await base44.asServiceRole.entities.CharacterFinancial.create({
            character_id: char.id,
            character_name: char.name,
            current_balance: 6000,
          });
        }

        let currentBalance = financial.current_balance || 6000;
        let totalExpensesAdded = 0;

        // Loop through each day from creation to today
        const currentDate = new Date(createdDate);
        let daysCharged = 0;

        while (currentDate <= today) {
          // Deduct daily food cost
          currentBalance = Math.max(0, currentBalance - DAILY_FOOD_COST);
          totalExpensesAdded += DAILY_FOOD_COST;
          daysCharged++;

          // Create transaction for this day
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
            timestamp: new Date(currentDate).toISOString(),
            balance_after: currentBalance,
          });

          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Update CharacterFinancial with final balance
        await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
          current_balance: currentBalance,
          total_expenses: (financial.total_expenses || 0) + totalExpensesAdded,
        });

        console.log(`[retroactiveDailyFoodCharges] ${char.name}: charged ${daysCharged} days (${totalExpensesAdded} total) | new balance: ${currentBalance}`);
        totalChargesCreated += daysCharged;
        successCount++;
      } catch (err) {
        console.error(`[retroactiveDailyFoodCharges] Failed for ${char.name}:`, err.message);
        failureCount++;
      }
    }

    console.log(`[retroactiveDailyFoodCharges] Complete: ${successCount} characters, ${totalChargesCreated} daily charges created`);

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      processedSuccessfully: successCount,
      failed: failureCount,
      totalDailyChargesCreated: totalChargesCreated,
    });
  } catch (error) {
    console.error('[retroactiveDailyFoodCharges]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});