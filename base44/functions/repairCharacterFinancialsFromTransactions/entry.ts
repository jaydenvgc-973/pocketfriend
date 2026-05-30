import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reconstruct CharacterFinancial records from FinancialTransaction history.
 * For each active_created_character, calculates total_income and total_expenses
 * from all transactions and updates the CharacterFinancial record.
 * 
 * This ensures characters show accurate financial data immediately on card load.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all active_created_character records for this user
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email, character_type: 'active_created_character', status: 'active' },
      null,
      300
    );

    if (characters.length === 0) {
      return Response.json({
        success: true,
        message: 'No active characters to repair',
        count: 0
      });
    }

    const results = [];

    for (const character of characters) {
      // Fetch all transactions for this character
      const transactions = await base44.entities.FinancialTransaction.filter(
        { character_id: character.id },
        '-timestamp', // Newest first
        1000
      );

      let totalIncome = 0;
      let totalExpenses = 0;
      let currentBalance = 6000; // Default starting balance

      // Sum income and expenses from all transactions
      for (const txn of transactions) {
        if (txn.direction === 'income') {
          totalIncome += txn.amount || 0;
        } else if (txn.direction === 'expense') {
          totalExpenses += txn.amount || 0;
        }
      }

      // Get current balance from the most recent transaction
      if (transactions.length > 0 && transactions[0].balance_after !== undefined) {
        currentBalance = transactions[0].balance_after;
      }

      // Check if CharacterFinancial record exists
      const existing = await base44.asServiceRole.entities.CharacterFinancial.filter(
        { character_id: character.id }
      );

      const financialData = {
        character_id: character.id,
        character_name: character.name,
        owner_email: user.email,
        is_npc: false,
        current_balance: currentBalance,
        total_income: totalIncome,
        total_expenses: totalExpenses,
        last_updated: new Date().toISOString(),
      };

      let updated;
      if (existing.length > 0) {
        // Update existing record
        updated = await base44.asServiceRole.entities.CharacterFinancial.update(
          existing[0].id,
          financialData
        );
      } else {
        // Create new record
        updated = await base44.asServiceRole.entities.CharacterFinancial.create(
          financialData
        );
      }

      results.push({
        character_id: character.id,
        character_name: character.name,
        total_income: totalIncome,
        total_expenses: totalExpenses,
        current_balance: currentBalance,
        transaction_count: transactions.length,
        updated_at: updated.id
      });
    }

    return Response.json({
      success: true,
      message: `Repaired ${results.length} character financial records`,
      count: results.length,
      characters: results
    });
  } catch (error) {
    console.error('[repairCharacterFinancialsFromTransactions]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});