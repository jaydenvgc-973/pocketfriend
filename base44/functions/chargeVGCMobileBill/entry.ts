import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * chargeVGCMobileBill
 * 
 * Charges a single character a monthly VGC Mobile bill ($50).
 * Creates a FinancialTransaction record and updates CharacterFinancial.
 * Called by:
 *   - Character creation (immediate charge)
 *   - Monthly automation (1st of month)
 */

const VGC_MOBILE_MONTHLY_COST = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, billingMonth } = await req.json();
    
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Fetch character
    const char = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    // Fetch or create CharacterFinancial
    const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId });
    let financial = financialRecs[0];
    
    if (!financial) {
      // Before creating with default, check if transactions exist
      const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: characterId }, null, 1);
      let startingBalance = 6000;
      if (transactions.length > 0) {
        // Recalculate from transactions
        const allTxns = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: characterId }, null, 500);
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
        character_id: characterId,
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
    const displayMonth = billingMonth || now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    const transaction = await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: char.name,
      sender_id: 'vgc_mobile_system',
      sender_type: 'system',
      sender_name: 'VGC Mobile',
      receiver_id: characterId,
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
      const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: char.created_by });
      if (userSettings[0]) {
        const currentRevenue = userSettings[0].vgc_mobile_revenue || 0;
        await base44.asServiceRole.entities.UserSettings.update(userSettings[0].id, {
          vgc_mobile_revenue: currentRevenue + VGC_MOBILE_MONTHLY_COST,
        });
      }
    }

    return Response.json({
      success: true,
      characterId,
      amount: VGC_MOBILE_MONTHLY_COST,
      newBalance,
      transactionId: transaction.id,
    });
  } catch (error) {
    console.error('[chargeVGCMobileBill]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});