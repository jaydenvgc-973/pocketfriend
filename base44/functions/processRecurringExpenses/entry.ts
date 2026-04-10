import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Process recurring monthly expenses
 * Runs daily to check if any monthly expenses are due today
 * and creates transactions for them
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
        const recurringExpenses = fin.recurring_expenses || [];

        for (const expense of recurringExpenses) {
          // Check if this expense is due today
          const dueDay = expense.due_day || 1;
          if (dueDay !== dayOfMonth) continue;

          // Check if transaction already exists for today
          const existingTxn = await base44.asServiceRole.entities.FinancialTransaction.filter({
            character_id: character.id,
            transaction_type: expense.expense_type,
            location_id: expense.location_id,
          });

          const today_str = today.toISOString().split('T')[0];
          const alreadyPosted = existingTxn.some(t => {
            if (!t.timestamp) return false;
            const txn_date = new Date(t.timestamp).toISOString().split('T')[0];
            return txn_date === today_str && t.description?.includes(expense.description || expense.expense_type);
          });

          if (alreadyPosted) continue;

          // Create transaction
          const transaction = await base44.asServiceRole.entities.FinancialTransaction.create({
            character_id: character.id,
            character_name: character.name,
            sender_type: 'system',
            sender_name: 'Recurring Charge',
            receiver_type: 'system',
            receiver_name: 'Account',
            amount: expense.monthly_cost || 0,
            direction: 'expense',
            transaction_type: expense.expense_type,
            description: `${expense.description || expense.expense_type} (Monthly)`,
            location_id: expense.location_id || null,
            location_name: expense.location_name || null,
            balance_after: fin.current_balance - (expense.monthly_cost || 0),
            timestamp: new Date().toISOString(),
          });

          // Update character's current balance
          const newBalance = fin.current_balance - (expense.monthly_cost || 0);
          await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
            current_balance: newBalance,
            total_expenses: (fin.total_expenses || 0) + (expense.monthly_cost || 0),
            last_updated: new Date().toISOString(),
          });

          results.push({
            characterId: character.id,
            characterName: character.name,
            expenseType: expense.expense_type,
            amount: expense.monthly_cost,
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