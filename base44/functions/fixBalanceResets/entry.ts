import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * fixBalanceResets
 * 
 * Repairs balance resets by:
 * 1. Ensuring CharacterFinancial is never created with default 6000 if transactions exist
 * 2. Recalculating balance from transaction history
 * 3. Updating total_income and total_expenses to match transactions
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const characters = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const results = [];
    let fixed = 0;

    for (const char of characters) {
      try {
        // Get financial record
        const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: char.id,
        });

        let financial = financials[0];

        // Fetch all transactions
        const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter(
          { character_id: char.id },
          '-timestamp',
          500
        );

        if (transactions.length === 0) {
          // No transactions — ensure record exists with 6000 starting balance
          if (!financial) {
            financial = await base44.asServiceRole.entities.CharacterFinancial.create({
              character_id: char.id,
              character_name: char.name,
              current_balance: 6000,
              total_income: 0,
              total_expenses: 0,
            });
            results.push({
              character_id: char.id,
              character_name: char.name,
              action: 'created_financial_record',
              new_balance: 6000,
            });
          }
          continue;
        }

        // Calculate correct balance from transactions
        let calculatedBalance = 6000;
        let totalIncome = 0;
        let totalExpenses = 0;

        for (const tx of transactions) {
          if (tx.direction === 'income') {
            const amount = tx.amount || 0;
            calculatedBalance += amount;
            totalIncome += amount;
          } else if (tx.direction === 'expense') {
            const amount = tx.amount || 0;
            calculatedBalance -= amount;
            totalExpenses += amount;
          }
        }

        if (!financial) {
          // Create with correct balance from transactions
          financial = await base44.asServiceRole.entities.CharacterFinancial.create({
            character_id: char.id,
            character_name: char.name,
            current_balance: Math.max(0, calculatedBalance),
            total_income: totalIncome,
            total_expenses: totalExpenses,
          });
          fixed++;
          results.push({
            character_id: char.id,
            character_name: char.name,
            action: 'created_with_transaction_history',
            transactions: transactions.length,
            calculated_balance: Math.max(0, calculatedBalance),
            total_income: totalIncome,
            total_expenses: totalExpenses,
          });
        } else {
          // Update with correct values from transactions
          const currentBalance = financial.current_balance || 0;
          const recordedIncome = financial.total_income || 0;
          const recordedExpenses = financial.total_expenses || 0;

          const balanceWrong = currentBalance !== calculatedBalance;
          const incomeWrong = recordedIncome !== totalIncome;
          const expensesWrong = recordedExpenses !== totalExpenses;

          if (balanceWrong || incomeWrong || expensesWrong) {
            await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
              current_balance: Math.max(0, calculatedBalance),
              total_income: totalIncome,
              total_expenses: totalExpenses,
            });
            fixed++;
            results.push({
              character_id: char.id,
              character_name: char.name,
              action: 'updated_from_transactions',
              old_balance: currentBalance,
              new_balance: calculatedBalance,
              old_income: recordedIncome,
              new_income: totalIncome,
              old_expenses: recordedExpenses,
              new_expenses: totalExpenses,
              transactions: transactions.length,
            });
          }
        }
      } catch (err) {
        console.error(`[fixBalanceResets] Error processing ${char.name}:`, err.message);
        results.push({
          character_id: char.id,
          character_name: char.name,
          error: err.message,
        });
      }
    }

    // Also fix UserSettings
    const userSettings = await base44.asServiceRole.entities.UserSettings.list();
    let userFixed = 0;
    for (const settings of userSettings) {
      // UserSettings balance doesn't have transactions to verify against
      // but we should at least ensure it's initialized to 6000 on first run
      if (!settings.user_balance) {
        await base44.asServiceRole.entities.UserSettings.update(settings.id, {
          user_balance: 6000,
        });
        userFixed++;
      }
    }

    return Response.json({
      success: true,
      characters_fixed: fixed,
      total_results: results.length,
      user_settings_initialized: userFixed,
      details: results.slice(0, 20), // Return first 20 for inspection
    });
  } catch (error) {
    console.error('[fixBalanceResets]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});