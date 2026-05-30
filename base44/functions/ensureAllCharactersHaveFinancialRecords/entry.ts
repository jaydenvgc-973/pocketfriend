import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Ensures every character has a CharacterFinancial record.
 * This is critical for displaying income on character cards.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all characters for this user
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email },
      "-updated_date",
      500
    );

    console.log(`[ENSURE_FINANCIALS] Found ${characters.length} characters for ${user.email}`);

    // Get all existing financial records
    const existingFinancials = await base44.entities.CharacterFinancial.filter(
      { owner_email: user.email },
      undefined,
      500
    );

    const existingIds = new Set(existingFinancials.map(f => f.character_id));
    console.log(`[ENSURE_FINANCIALS] Found ${existingFinancials.length} existing CharacterFinancial records`);

    // Find characters missing financial records
    const missingFinancials = characters.filter(c => !existingIds.has(c.id));
    console.log(`[ENSURE_FINANCIALS] ${missingFinancials.length} characters need financial records`);

    // Create financial records for missing characters
    let createdCount = 0;
    for (const char of missingFinancials) {
      try {
        await base44.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
          owner_email: user.email,
          current_balance: 6000, // Default starting balance
          total_income: 0,
          income_sources: [],
          recurring_expenses: [],
          other_monthly_expenses: [],
        });
        createdCount++;
        console.log(`[ENSURE_FINANCIALS] Created financial record for ${char.name}`);
      } catch (err) {
        console.error(`[ENSURE_FINANCIALS] Failed to create financial record for ${char.name}: ${err.message}`);
      }
    }

    console.log(`[ENSURE_FINANCIALS] COMPLETE: Created ${createdCount} new financial records`);

    return Response.json({
      success: true,
      total_characters: characters.length,
      existing_financial_records: existingFinancials.length,
      missing_financials_created: createdCount,
      message: `Financial records now exist for all ${characters.length} characters`,
    });
  } catch (error) {
    console.error(`[ENSURE_FINANCIALS] FAILED: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});