import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Process recurring monthly expenses
 * Runs daily on day 1 of month to create transactions for all recurring expenses
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date();
    const dayOfMonth = today.getDate();

    // Only process on day 1 of each month
    if (dayOfMonth !== 1) {
      return Response.json({ success: true, processedCount: 0, results: [] });
    }

    // Get all characters created by this user
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active'
    });

    const results = [];

    for (const character of characters) {
      try {
        const financial = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: character.id
        });

        if (!financial || financial.length === 0) continue;

        const fin = financial[0];
        const recurringExpenses = fin.other_monthly_expenses || [];

        for (const expense of recurringExpenses) {
          // Check if transaction already created today for this expense
          const existingTxn = await base44.asServiceRole.entities.FinancialTransaction.filter({
            character_id: character.id,
            transaction_type: expense.type,
            description: expense.name,
          });

          const today_str = today.toISOString().split('T')[0];
          const alreadyPosted = existingTxn.some(t => {
            if (!t.timestamp) return false;
            const txn_date = new Date(t.timestamp).toISOString().split('T')[0];
            return txn_date === today_str;
          });

          if (alreadyPosted) continue;

          // Create transaction for this recurring expense
          const newBalance = fin.current_balance - (expense.amount || 0);
          const transaction = await base44.asServiceRole.entities.FinancialTransaction.create({
            character_id: character.id,
            character_name: character.name,
            sender_type: 'system',
            sender_name: 'Monthly Expense',
            receiver_type: 'system',
            receiver_name: expense.name,
            amount: expense.amount || 0,
            direction: 'expense',
            transaction_type: expense.type,
            description: expense.name,
            location_id: null,
            location_name: null,
            balance_after: newBalance,
            timestamp: new Date().toISOString(),
          });

          // Update character's current balance
          const updatedExpenses = fin.other_monthly_expenses.map(e => 
            e.name === expense.name ? { ...e, last_payment_date: new Date().toISOString(), total_paid: (e.total_paid || 0) + (e.amount || 0) } : e
          );
          
          await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
            current_balance: newBalance,
            total_expenses: (fin.total_expenses || 0) + (expense.amount || 0),
            other_monthly_expenses: updatedExpenses,
            last_updated: new Date().toISOString(),
          });

          results.push({
            characterId: character.id,
            characterName: character.name,
            expenseName: expense.name,
            amount: expense.amount,
            transactionId: transaction.id,
            newBalance,
          });
        }
      } catch (charErr) {
        console.error(`Error processing character ${character.id}:`, charErr.message);
      }
    }

    return Response.json({
      success: true,
      processedCount: results.length,
      results,
    });
  } catch (error) {
    console.error('[processRecurringExpenses]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});