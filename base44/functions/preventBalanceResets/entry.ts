import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * preventBalanceResets
 * 
 * SAFETY GUARD: Runs after financial operations to detect and fix balance resets.
 * Compares current balance against transaction history.
 * If balance < sum of actual transactions, recalculates and restores.
 * 
 * Call this as a post-operation hook or scheduled task.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const characters = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const corrections = [];
    const userCorrections = [];

    // Fix characters
    for (const char of characters) {
      try {
        const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: char.id,
        });

        if (!financials[0]) continue;
        const financial = financials[0];
        const currentBalance = financial.current_balance || 0;

        // Get all transactions
        const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter(
          { character_id: char.id },
          '-timestamp',
          500
        );

        if (transactions.length === 0) continue;

        // Calculate expected balance
        let expectedBalance = 6000;
        for (const tx of transactions) {
          if (tx.direction === 'income') {
            expectedBalance += tx.amount || 0;
          } else if (tx.direction === 'expense') {
            expectedBalance -= tx.amount || 0;
          }
        }
        expectedBalance = Math.max(0, expectedBalance);

        // If balance was reset (current < expected), fix it
        if (currentBalance < expectedBalance && expectedBalance - currentBalance > 50) {
          await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
            current_balance: expectedBalance,
          });

          corrections.push({
            character_id: char.id,
            character_name: char.name,
            reset_detected: true,
            old_balance: currentBalance,
            restored_balance: expectedBalance,
            transactions: transactions.length,
          });
        }
      } catch (err) {
        console.error(`[preventBalanceResets] Error for ${char.name}:`, err.message);
      }
    }

    // Fix UserSettings
    const userSettings = await base44.asServiceRole.entities.UserSettings.list();
    for (const settings of userSettings) {
      const currentBalance = settings.user_balance || 0;
      
      // User balance should never be exactly 6000 unless they just started
      // If it's exactly 6000 but created_date is old, it was likely reset
      if (currentBalance === 6000 && settings.created_date) {
        const createdDate = new Date(settings.created_date);
        const now = new Date();
        const daysSinceCreation = (now - createdDate) / (1000 * 60 * 60 * 24);
        
        // If user account is > 7 days old and balance = 6000, likely a reset
        if (daysSinceCreation > 7) {
          userCorrections.push({
            user_email: settings.created_by,
            issue: 'Balance = $6,000 for old account (likely reset)',
            days_old: Math.round(daysSinceCreation),
            current_balance: currentBalance,
          });
        }
      }
    }

    return Response.json({
      success: true,
      characters_checked: characters.length,
      resets_corrected: corrections.length,
      user_accounts_flagged: userCorrections.length,
      corrections: corrections.slice(0, 20),
      user_issues: userCorrections.slice(0, 10),
    });
  } catch (error) {
    console.error('[preventBalanceResets]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});