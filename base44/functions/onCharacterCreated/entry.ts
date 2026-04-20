import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const VGC_MOBILE_MONTHLY_COST = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data: character } = await req.json();

    if (!character || !character.id) {
      return Response.json({ error: 'No character data in payload' }, { status: 400 });
    }

    const isNPC = ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person'].includes(character.character_type);
    const isActive = character.character_type === 'active';

    // ── NPC: Auto-assign VGC Towers as home (if not already set) ─────────────
    if (isNPC && !character.current_home_location_id) {
      try {
        const ownerEmail = character.owner_email || character.created_by;
        if (ownerEmail) {
          // Find this user's private VGC Towers instance
          const [byCreated, byOwner] = await Promise.all([
            base44.asServiceRole.entities.LocationReference.filter({ created_by: ownerEmail, name: 'VGC Towers' }),
            base44.asServiceRole.entities.LocationReference.filter({ owner_email: ownerEmail, name: 'VGC Towers' }),
          ]);
          const seenIds = new Set();
          const userVGC = [...byCreated, ...byOwner].find(l => {
            if (seenIds.has(l.id)) return false;
            seenIds.add(l.id);
            return l.scope !== 'shared';
          });

          if (userVGC) {
            const now = new Date().toISOString();
            await base44.asServiceRole.entities.Character.update(character.id, {
              current_home_location_id: userVGC.id,
              resolved_current_location_id: userVGC.id,
              resolved_current_location_name: userVGC.name,
              resolved_location_type: 'home',
              resolved_presence_status: 'home',
              resolved_source_reason: 'npc_default_home',
              resolved_last_updated_at: now,
              location_status: 'home',
              travel_status: 'not_traveling',
              location_visibility_state: 'visible',
              presence_state: 'home',
            });

            // Add to VGC Towers resident lists
            const residentIds = Array.from(new Set([...(userVGC.resident_character_ids || []), character.id]));
            const residentNames = Array.from(new Set([...(userVGC.resident_character_names || []), character.name]));
            await base44.asServiceRole.entities.LocationReference.update(userVGC.id, {
              resident_character_ids: residentIds,
              resident_character_names: residentNames,
            });
            console.log(`[onCharacterCreated] NPC ${character.name} assigned to VGC Towers (${userVGC.id}) for ${ownerEmail}`);
          } else {
            console.warn(`[onCharacterCreated] No user-scoped VGC Towers found for ${ownerEmail} — NPC ${character.name} has no home`);
          }
        }
      } catch (npcHomeErr) {
        console.error('[onCharacterCreated] Failed to assign NPC home:', npcHomeErr.message);
      }
    }

    // Skip VGC Mobile charge and home linking for NPCs — only active characters get billed
    if (!isActive || character.status !== 'active') {
      return Response.json({ success: true, skipped: true, reason: isNPC ? 'NPC assigned home, no billing' : 'Not an active character' });
    }

    // ── ACTIVE CHARACTER: Auto-link home location ─────────────────────────────
    try {
      const homeId = character.current_home_location_id;
      if (homeId) {
        const home = await base44.asServiceRole.entities.LocationReference.get(homeId);
        if (home) {
          const residentIds = Array.from(new Set([...(home.resident_character_ids || []), character.id]));
          const residentNames = Array.from(new Set([...(home.resident_character_names || []), character.name]));
          await base44.asServiceRole.entities.LocationReference.update(homeId, {
            resident_character_ids: residentIds,
            resident_character_names: residentNames,
          });
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
    }

    // ── ACTIVE CHARACTER: Charge VGC Mobile ──────────────────────────────────
    try {
      const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: character.id });
      let financial = financialRecs[0];

      if (!financial) {
        const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: character.id }, null, 1);
        let startingBalance = 6000;
        if (transactions.length > 0) {
          const allTxns = await base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: character.id }, null, 500);
          startingBalance = 6000;
          for (const tx of allTxns) {
            if (tx.direction === 'income') startingBalance += tx.amount || 0;
            else if (tx.direction === 'expense') startingBalance -= tx.amount || 0;
          }
        }
        financial = await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: character.id,
          character_name: character.name,
          current_balance: Math.max(0, startingBalance),
        });
      }

      const newBalance = Math.max(0, (financial.current_balance || 6000) - VGC_MOBILE_MONTHLY_COST);
      await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
        current_balance: newBalance,
        total_expenses: (financial.total_expenses || 0) + VGC_MOBILE_MONTHLY_COST,
      });

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

      // User revenue from VGC Mobile
      if (character.created_by) {
        const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: character.created_by }, null, 1);
        let userSettings = userSettingsList[0];
        if (!userSettings) {
          await base44.asServiceRole.entities.UserSettings.create({ vgc_mobile_revenue: VGC_MOBILE_MONTHLY_COST });
        } else {
          await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
            vgc_mobile_revenue: (userSettings.vgc_mobile_revenue || 0) + VGC_MOBILE_MONTHLY_COST,
          });
        }
      }
    } catch (chargeErr) {
      console.error('[onCharacterCreated] Failed to charge VGC Mobile:', chargeErr.message);
    }

    return Response.json({ success: true, characterId: character.id });
  } catch (error) {
    console.error('[onCharacterCreated]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});