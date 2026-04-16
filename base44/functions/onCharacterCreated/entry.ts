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

    // ── AUTO-LINK HOME LOCATION ───────────────────────────────────────────────
    // If the character has a current_home_location_id set, ensure the LocationReference
    // lists them as a resident AND the character fields are fully populated.
    try {
      const homeId = character.current_home_location_id;
      if (homeId) {
        const home = await base44.asServiceRole.entities.LocationReference.get(homeId);
        if (home) {
          // Ensure character is in resident lists
          const residentIds = Array.from(new Set([...(home.resident_character_ids || []), character.id]));
          const residentNames = Array.from(new Set([...(home.resident_character_names || []), character.name]));
          await base44.asServiceRole.entities.LocationReference.update(homeId, {
            resident_character_ids: residentIds,
            resident_character_names: residentNames,
          });
          // Ensure character's resolved presence fields are set
          await base44.asServiceRole.entities.Character.update(character.id, {
            location_status: 'home',
            resolved_current_location_id: homeId,
            resolved_current_location_name: home.name,
            resolved_location_type: 'home',
            resolved_presence_status: 'home',
          });
          console.log(`[onCharacterCreated] Auto-linked ${character.name} to home: ${home.name}`);
        }
      }
    } catch (homeLinkErr) {
      console.error('[onCharacterCreated] Failed to auto-link home location:', homeLinkErr.message);
      // Non-fatal — character still created
    }

    // Charge VGC Mobile immediately
    try {
      // Fetch or create CharacterFinancial
      const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: character.id });
      let financial = financialRecs[0];
      
      if (!financial) {
        // Before creating with default, check if transactions exist
        const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: character.id }, null, 1);
        let startingBalance = 6000;
        if (transactions.length > 0) {
          // Recalculate from transactions
          const allTxns = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: character.id }, null, 500);
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
          character_id: character.id,
          character_name: character.name,
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
        const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ }, null, 1);
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