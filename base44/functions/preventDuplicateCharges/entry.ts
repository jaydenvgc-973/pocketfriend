import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * preventDuplicateCharges
 * 
 * SAFETY GUARD: Runs after any billing automation to detect and remove duplicate charges.
 * Checks for same charge type > 2x per day and removes duplicates.
 * Recalculates balances to ensure consistency.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const characters = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const today = new Date().toISOString().substring(0, 10);
    const results = [];
    let duplicatesRemoved = 0;

    for (const char of characters) {
      try {
        // Get today's transactions
        const txs = await base44.asServiceRole.entities.FinancialTransaction.filter(
          { character_id: char.id },
          '-timestamp',
          100
        );

        const todaysTxs = txs.filter(t => t.timestamp?.substring(0, 10) === today);

        // Group by type + description
        const byTypeDesc = {};
        for (const tx of todaysTxs) {
          const key = `${tx.transaction_type}_${tx.description}`;
          if (!byTypeDesc[key]) {
            byTypeDesc[key] = [];
          }
          byTypeDesc[key].push(tx);
        }

        // Find duplicates
        const toDelete = [];
        for (const [key, txList] of Object.entries(byTypeDesc)) {
          if (txList.length > 2) {
            // Keep oldest (first), delete newer ones
            const sorted = [...txList].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            toDelete.push(...sorted.slice(1));
          }
        }

        // Delete duplicates
        for (const tx of toDelete) {
          await base44.asServiceRole.entities.FinancialTransaction.delete(tx.id).catch(() => {});
        }

        if (toDelete.length > 0) {
          duplicatesRemoved += toDelete.length;
          results.push({
            character_id: char.id,
            character_name: char.name,
            duplicates_removed: toDelete.length,
            amount_reversed: toDelete.reduce((s, t) => s + (t.amount || 0), 0),
          });

          // Recalculate balance
          const allTxs = await base44.asServiceRole.entities.FinancialTransaction.filter(
            { character_id: char.id },
            null,
            500
          );

          let newBalance = 6000;
          for (const tx of allTxs) {
            if (tx.direction === 'income') {
              newBalance += tx.amount || 0;
            } else if (tx.direction === 'expense') {
              newBalance -= tx.amount || 0;
            }
          }
          newBalance = Math.max(0, newBalance);

          const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
            character_id: char.id,
          });

          if (financials[0]) {
            await base44.asServiceRole.entities.CharacterFinancial.update(financials[0].id, {
              current_balance: newBalance,
            });
          }
        }
      } catch (err) {
        console.error(`Error processing ${char.name}:`, err.message);
      }
    }

    return Response.json({
      success: true,
      characters_checked: characters.length,
      duplicates_removed_total: duplicatesRemoved,
      characters_affected: results.length,
      details: results.slice(0, 20),
    });
  } catch (error) {
    console.error('[preventDuplicateCharges]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});