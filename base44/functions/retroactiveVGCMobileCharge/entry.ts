import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const VGC_MOBILE_MONTHLY_COST = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all active created characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    // Charge each character for April 2026
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

        // Deduct from character balance
        const newBalance = Math.max(0, (financial.current_balance || 6000) - VGC_MOBILE_MONTHLY_COST);
        await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
          current_balance: newBalance,
          total_expenses: (financial.total_expenses || 0) + VGC_MOBILE_MONTHLY_COST,
        });

        // Create transaction record
        const now = new Date();
        const displayMonth = 'April 2026';
        
        await base44.asServiceRole.entities.FinancialTransaction.create({
          character_id: char.id,
          character_name: char.name,
          sender_id: 'vgc_mobile_system',
          sender_type: 'system',
          sender_name: 'VGC Mobile',
          receiver_id: char.id,
          receiver_type: 'character',
          receiver_name: char.name,
          amount: VGC_MOBILE_MONTHLY_COST,
          direction: 'expense',
          transaction_type: 'utilities',
          description: `VGC Mobile monthly phone bill (${displayMonth})`,
          timestamp: now.toISOString(),
          balance_after: newBalance,
        });

        // Increase user revenue (character's creator benefits from this)
        if (char.created_by) {
          const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({}, null, 1);
          let userSettings = userSettingsList[0];
          
          if (!userSettings) {
            userSettings = await base44.asServiceRole.entities.UserSettings.create({
              vgc_mobile_revenue: VGC_MOBILE_MONTHLY_COST,
            });
          } else {
            const currentRevenue = userSettings.vgc_mobile_revenue || 0;
            await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
              vgc_mobile_revenue: currentRevenue + VGC_MOBILE_MONTHLY_COST,
            });
          }
        }

        successCount++;
      } catch (err) {
        console.error(`[retroactiveVGCMobileCharge] Failed to charge ${char.name}:`, err.message);
        failureCount++;
        failures.push({ characterId: char.id, name: char.name, error: err.message });
      }
    }

    console.log(`[retroactiveVGCMobileCharge] Retroactive billing complete: ${successCount} charged, ${failureCount} failed`);

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      charged: successCount,
      failed: failureCount,
      failures: failures.length > 0 ? failures : undefined,
    });
  } catch (error) {
    console.error('[retroactiveVGCMobileCharge]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});