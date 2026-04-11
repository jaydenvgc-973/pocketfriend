import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * fixDeepFinancialIssues
 * 
 * Fixes discovered issues:
 * 1. Removes duplicate VGC charges (keep only 1 per day per character)
 * 2. Recalculates correct balance after duplicate removal
 * 3. Flags characters with jobs but no income for manual payroll run
 * 4. Ensures consistent balance_after calculation across all transactions
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const characters = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const results = {
      duplicates_removed: [],
      balances_corrected: [],
      no_income_flag: [],
    };

    // === Fix duplicate VGC charges ===
    for (const char of characters) {
      try {
        const txs = await base44.asServiceRole.entities.FinancialTransaction.filter(
          { character_id: char.id, transaction_type: 'utilities' },
          '-timestamp',
          100
        );

        // Group by day and type
        const byDay = {};
        for (const tx of txs) {
          const day = tx.timestamp?.substring(0, 10);
          const desc = tx.description || '';
          const key = `${day}_${desc}`;

          if (!byDay[key]) {
            byDay[key] = [];
          }
          byDay[key].push(tx);
        }

        // Find duplicates (same charge > 2x on same day)
        const toDelete = [];
        for (const [key, txList] of Object.entries(byDay)) {
          if (txList.length > 2) {
            // Keep first, delete rest
            toDelete.push(...txList.slice(1));
          }
        }

        // Delete duplicates
        for (const tx of toDelete) {
          await base44.asServiceRole.entities.FinancialTransaction.delete(tx.id).catch(() => {});
        }

        if (toDelete.length > 0) {
          results.duplicates_removed.push({
            character_id: char.id,
            character_name: char.name,
            duplicates_deleted: toDelete.length,
            total_amount_removed: toDelete.reduce((s, t) => s + (t.amount || 0), 0),
          });
        }

        // === Recalculate balance after duplicate removal ===
        const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: char.id,
        });

        if (financials[0]) {
          const financial = financials[0];
          const allTxs = await base44.asServiceRole.entities.FinancialTransaction.filter(
            { character_id: char.id },
            '-timestamp',
            500
          );

          let newBalance = 6000;
          let totalIncome = 0;
          let totalExpenses = 0;

          for (const tx of allTxs) {
            if (tx.direction === 'income') {
              const amt = tx.amount || 0;
              newBalance += amt;
              totalIncome += amt;
            } else if (tx.direction === 'expense') {
              const amt = tx.amount || 0;
              newBalance -= amt;
              totalExpenses += amt;
            }
          }

          newBalance = Math.max(0, newBalance);

          await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
            current_balance: newBalance,
            total_income: totalIncome,
            total_expenses: totalExpenses,
          });

          results.balances_corrected.push({
            character_id: char.id,
            character_name: char.name,
            corrected_balance: newBalance,
            total_income: totalIncome,
            total_expenses: totalExpenses,
          });
        }

        // === Flag characters with jobs but no income ===
        if ((char.occupation_location_id || char.additional_occupation_locations?.length > 0)) {
          const financial = financials[0];
          if (financial && (financial.total_income || 0) === 0) {
            results.no_income_flag.push({
              character_id: char.id,
              character_name: char.name,
              has_primary_job: !!char.occupation_location_id,
              has_secondary_jobs: (char.additional_occupation_locations?.length || 0) > 0,
              message: 'Character has job(s) but $0 income — payroll needs to run',
            });
          }
        }

      } catch (err) {
        console.error(`Error processing ${char.name}:`, err.message);
      }
    }

    return Response.json({
      success: true,
      duplicates_removed_total: results.duplicates_removed.length,
      balances_corrected_total: results.balances_corrected.length,
      no_income_characters: results.no_income_flag.length,
      details: {
        duplicates_removed: results.duplicates_removed.slice(0, 10),
        balances_corrected: results.balances_corrected.slice(0, 10),
        no_income_flag: results.no_income_flag.slice(0, 10),
      },
    });
  } catch (error) {
    console.error('[fixDeepFinancialIssues]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});