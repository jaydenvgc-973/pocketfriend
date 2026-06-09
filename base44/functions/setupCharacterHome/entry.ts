import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let characterId, characterName;
    const body = await req.json();
    
    // Support both direct params and automation payload format
    if (body.event) {
      // Automation trigger format
      characterId = body.data?.id;
      characterName = body.data?.name;
    } else {
      // Direct function call format
      characterId = body.characterId;
      characterName = body.characterName;
    }

    if (!characterId || !characterName) {
      return Response.json({ error: 'characterId and characterName required' }, { status: 400 });
    }

    // Check if character already has a financial record
    const existingFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    );
    if (existingFinancial.length > 0) {
      return Response.json({ success: false, message: 'Financial record already exists' });
    }

    // Create financial record with no home location assigned
    // User must explicitly assign a home via the Locations page
    const financialRecord = await base44.asServiceRole.entities.CharacterFinancial.create({
      character_id: characterId,
      character_name: characterName,
      owner_email: user.email,
      home_location_id: null,
      home_location_name: null,
      is_homeless: true,
      total_income: 0,
      total_expenses: 0,
      current_balance: 6000,
      income_sources: [],
      recurring_expenses: [],
      last_updated: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      financial_record_id: financialRecord.id,
      message: 'Financial record created. User must assign a home location via Locations page.',
    });
  } catch (error) {
    console.error('[setupCharacterHome]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});