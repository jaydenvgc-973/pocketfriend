import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const VGC_MOBILE_MONTHLY_COST = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data: character } = await req.json();

    if (!character || !character.id) {
      return Response.json({ error: 'No character data in payload' }, { status: 400 });
    }

    // Skip if not an active created character
    if (character.character_type !== 'active' || character.status !== 'active') {
      return Response.json({ success: true, skipped: true, reason: 'Not an active character' });
    }

    // Charge VGC Mobile immediately
    try {
      // Fetch or create CharacterFinancial
      const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: character.id });
      let financial = financialRecs[0];
      
      if (!financial) {
        financial = await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: character.id,
          character_name: character.name,
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
      const now = new Date();
      const billingMonth = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: character.id,
        character_name: character.name,
        sender_id: 'vgc_mobile_system',
        sender_type: 'system',
        sender_name: 'VGC Mobile',
        receiver_id: character.id,
        receiver_type: 'character',
        receiver_name: character.name,
        amount: VGC_MOBILE_MONTHLY_COST,
        direction: 'expense',
        transaction_type: 'utilities',
        description: `VGC Mobile monthly phone bill (${billingMonth})`,
        timestamp: now.toISOString(),
        balance_after: newBalance,
      });

      // Increase user revenue (character's creator benefits from this)
      if (character.created_by) {
        const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: character.created_by }, null, 1);
        let userSettings = userSettingsList[0];
        
        if (!userSettings) {
          userSettings = await base44.asServiceRole.entities.UserSettings.create({
            created_by: character.created_by,
            vgc_mobile_revenue: VGC_MOBILE_MONTHLY_COST,
          });
        } else {
          const currentRevenue = userSettings.vgc_mobile_revenue || 0;
          await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
            vgc_mobile_revenue: currentRevenue + VGC_MOBILE_MONTHLY_COST,
          });
        }
      }
    } catch (chargeErr) {
      console.error('[onCharacterCreated] Failed to charge VGC Mobile:', chargeErr.message);
      // Don't fail the entire hook if billing fails — character still created
    }

    return Response.json({ success: true, characterId: character.id });
  } catch (error) {
    console.error('[onCharacterCreated]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});