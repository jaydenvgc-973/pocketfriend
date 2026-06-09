import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Initialize or update financial record for a character.
 * Called during character creation or via backfill.
 * Sets starting money to $6,000 and creates default expense structure.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId, characterName, isNpc = false, homeLocationId = null, homeLocationName = null } = body;

    if (!characterId || !characterName) {
      return Response.json({ error: 'characterId and characterName required' }, { status: 400 });
    }

    // Check if record already exists
    const existing = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    );

    const financialData = {
      character_id: characterId,
      character_name: characterName,
      owner_email: user.email,
      is_npc: isNpc,
      home_location_id: homeLocationId || null,
      home_location_name: homeLocationName || null,
      is_homeless: !homeLocationId,
      current_balance: 6000,
      total_income: 0,
      total_expenses: 0,
      income_sources: [],
      recurring_expenses: [],
      last_updated: new Date().toISOString(),
    };

    let result;
    if (existing.length > 0) {
      // Update existing, preserving balances
      result = await base44.asServiceRole.entities.CharacterFinancial.update(existing[0].id, {
        ...financialData,
        current_balance: existing[0].current_balance || 6000,
        total_income: existing[0].total_income || 0,
        total_expenses: existing[0].total_expenses || 0,
      });
    } else {
      // Create new
      result = await base44.asServiceRole.entities.CharacterFinancial.create(financialData);
    }

    return Response.json({
      success: true,
      financial_record_id: result.id,
      initial_balance: 6000,
    });
  } catch (error) {
    console.error('[initializeCharacterFinancials]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});