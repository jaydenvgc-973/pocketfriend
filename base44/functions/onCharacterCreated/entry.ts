import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VGC_MOBILE_MONTHLY_COST = 50;
const OFF_APP_RENT = 3000; // Default monthly rent for characters with no in-app home

/**
 * Determines if a character requires off-app rent:
 * - Must be an active_created_character
 * - Must have NO valid in-app home location (current_home_location_id is null/empty)
 * - Must NOT be homeless, in a shelter, or in a hotel (housing_context checks)
 */
function requiresOffAppRent(character) {
  if (character.character_type !== 'active_created_character') return false;
  if (character.current_home_location_id) return false; // has a real in-app home
  if (character.is_homeless) return false;
  if (character.housing_context === 'temporary_shelter' || character.housing_context === 'homeless_unsheltered') return false;
  if (character.temporary_housing_location_id) return false; // hotel/shelter
  return true;
}

/**
 * Charges off-app rent and updates CharacterFinancial.
 * Returns the new balance.
 */
async function chargeOffAppRent(base44, character, financial, label) {
  const amount = OFF_APP_RENT;
  const newBalance = Math.max(0, (financial.current_balance || 6000) - amount);
  await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
    current_balance: newBalance,
    total_expenses: (financial.total_expenses || 0) + amount,
    last_updated: new Date().toISOString(),
  });
  await base44.asServiceRole.entities.FinancialTransaction.create({
    character_id: character.id,
    character_name: character.name,
    sender_id: 'rent_system',
    sender_type: 'system',
    sender_name: 'Rent System',
    receiver_id: character.id,
    receiver_type: 'character',
    receiver_name: character.name,
    amount,
    direction: 'expense',
    transaction_type: 'rent',
    description: `Off-app living situation rent (${label})`,
    timestamp: new Date().toISOString(),
    balance_after: newBalance,
  });
  console.log(`[onCharacterCreated] Off-app rent charged $${amount} (${label}) to ${character.name} — new balance: $${newBalance}`);
  return newBalance;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data: character } = await req.json();

    if (!character || !character.id) {
      return Response.json({ error: 'No character data in payload' }, { status: 400 });
    }

    // Ownership: use owner_email exclusively. created_by is FORBIDDEN.
    const ownerEmail = character.owner_email;

    const isNPC = ['npc_regular', 'npc_family_member', 'npc_fictitious'].includes(character.character_type);
    const isActive = character.character_type === 'active_created_character';

    // ── NPC: Auto-assign VGC Towers as home (if not already set) ─────────────
    if (isNPC && !character.current_home_location_id) {
      try {
        if (ownerEmail) {
          const userVGCList = await base44.asServiceRole.entities.LocationReference.filter({
            owner_email: ownerEmail,
            name: 'VGC Towers',
          });
          const userVGC = userVGCList.find(l => l.scope !== 'shared') || userVGCList[0];

          if (userVGC) {
            const now = new Date().toISOString();
            // Initialize sleep rhythm — backfill only if missing (preserve existing schedules)
            const sleepPatch = {};
            if (!character.sleep_start_time) sleepPatch.sleep_start_time = '23:00';
            if (!character.wake_up_time) sleepPatch.wake_up_time = '07:00';
            if (character.sleep_debt_hours === undefined || character.sleep_debt_hours === null) sleepPatch.sleep_debt_hours = 0;

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
              ...sleepPatch,
            });

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

    // Skip billing for NPCs
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

    // ── ACTIVE CHARACTER: Ensure CharacterFinancial record exists ─────────────
    let financial = null;
    try {
      const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: character.id });
      financial = financialRecs[0] || null;

      if (!financial) {
        financial = await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: character.id,
          character_name: character.name,
          current_balance: 6000,
          total_income: 0,
          total_expenses: 0,
        });
      }
    } catch (finErr) {
      console.error('[onCharacterCreated] Failed to ensure CharacterFinancial:', finErr.message);
    }

    // ── ACTIVE CHARACTER: Charge VGC Mobile ──────────────────────────────────
    try {
      if (financial) {
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

        // Refresh financial record after VGC charge
        financial = { ...financial, current_balance: newBalance, total_expenses: (financial.total_expenses || 0) + VGC_MOBILE_MONTHLY_COST };

        // User revenue from VGC Mobile
        if (ownerEmail) {
          const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1);
          const userSettings = userSettingsList[0];
          if (!userSettings) {
            await base44.asServiceRole.entities.UserSettings.create({
              owner_email: ownerEmail,
              vgc_mobile_revenue: VGC_MOBILE_MONTHLY_COST,
            });
          } else {
            await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
              vgc_mobile_revenue: (userSettings.vgc_mobile_revenue || 0) + VGC_MOBILE_MONTHLY_COST,
            });
          }
        }
      }
    } catch (chargeErr) {
      console.error('[onCharacterCreated] Failed to charge VGC Mobile:', chargeErr.message);
    }

    // ── ACTIVE CHARACTER: Off-app rent scheduling ─────────────────────────────
    // Only charge if the character has NO in-app home and is not homeless/sheltered.
    // Rule:
    //   - Charge 2 days after creation (initial rent)
    //   - UNLESS the 1st of next month falls within those 2 days → skip initial, charge on the 1st only.
    //   - Recurring: 1st of each month via processRecurringExpenses.
    try {
      if (financial && requiresOffAppRent(character)) {
        const now = new Date();
        const creationDate = now;

        // Compute the next 1st of month
        const nextFirst = new Date(creationDate.getFullYear(), creationDate.getMonth() + 1, 1);
        const msUntilFirst = nextFirst - creationDate;
        const daysUntilFirst = msUntilFirst / (1000 * 60 * 60 * 24);

        if (daysUntilFirst <= 2) {
          // 1st arrives within 2 days — skip early charge, let monthly billing handle it
          console.log(`[onCharacterCreated] Off-app rent: 1st of month is in ${daysUntilFirst.toFixed(1)} days — skipping 2-day charge, monthly billing will apply`);
        } else {
          // Charge now (creation = day 0, charge at 2-day mark = immediately for simplicity since
          // we can't schedule a delayed function here — we charge on creation as the "initial" rent)
          const chargeLabel = `initial — ${creationDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
          financial.current_balance = await chargeOffAppRent(base44, character, financial, chargeLabel);
        }

        // Register as a recurring_expense entry in CharacterFinancial so processRecurringExpenses
        // picks it up on the 1st of every month automatically — using the existing recurring expense path.
        const refreshed = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: character.id });
        const fin = refreshed[0];
        if (fin) {
          const existing = (fin.recurring_expenses || []);
          const alreadyHasRent = existing.some(e => e.expense_type === 'rent' && e.description === 'Off-app living situation rent');
          if (!alreadyHasRent) {
            await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
              recurring_expenses: [
                ...existing,
                {
                  expense_type: 'rent',
                  description: 'Off-app living situation rent',
                  monthly_cost: OFF_APP_RENT,
                  total_paid: 0,
                  last_payment_date: null,
                },
              ],
            });
            console.log(`[onCharacterCreated] Registered off-app rent ($${OFF_APP_RENT}/mo) as recurring expense for ${character.name}`);
          }
        }
      }
    } catch (rentErr) {
      console.error('[onCharacterCreated] Failed to schedule off-app rent:', rentErr.message);
    }

    return Response.json({ success: true, characterId: character.id });
  } catch (error) {
    console.error('[onCharacterCreated]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});