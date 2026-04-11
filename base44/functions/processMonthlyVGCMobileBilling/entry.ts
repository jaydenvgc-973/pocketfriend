import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const VGC_MOBILE_MONTHLY_COST = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all active characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const now = new Date();
    const billingMonth = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    let successCount = 0;
    let failureCount = 0;

    // Charge each character
    for (const char of allChars) {
      try {
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

        // Deduct from character balance
        const newBalance = Math.max(0, (financial.current_balance || 6000) - VGC_MOBILE_MONTHLY_COST);
        await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
          current_balance: newBalance,
          total_expenses: (financial.total_expenses || 0) + VGC_MOBILE_MONTHLY_COST,
        });

        // Create transaction record
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
          description: `VGC Mobile monthly phone bill (${billingMonth})`,
          timestamp: now.toISOString(),
          balance_after: newBalance,
        });

        // Increase user revenue (character's creator benefits from this)
        if (char.created_by) {
          const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: char.created_by }, null, 1);
          let userSettings = userSettingsList[0];
          
          if (!userSettings) {
            userSettings = await base44.asServiceRole.entities.UserSettings.create({
              created_by: char.created_by,
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
        console.error(`[processMonthlyVGCMobileBilling] Failed to charge ${char.name}:`, err.message);
        failureCount++;
      }
    }

    console.log(`[processMonthlyVGCMobileBilling] Charged ${successCount} characters, ${failureCount} failures`);

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      charged: successCount,
      failed: failureCount,
      month: billingMonth,
    });
  } catch (error) {
    console.error('[processMonthlyVGCMobileBilling]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});