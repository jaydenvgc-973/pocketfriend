import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * manualCharacterTransaction
 *
 * Writes a user-initiated manual deposit or withdrawal to the canonical
 * FinancialTransaction entity and updates CharacterFinancial.current_balance.
 *
 * This does NOT touch:
 *  - work income / payroll
 *  - recurring expenses
 *  - housing costs
 *  - automatic spending logic
 *  - NPC bills or spending rules
 *
 * Source of truth:
 *  - CharacterFinancial.current_balance  (canonical balance field)
 *  - FinancialTransaction                (canonical transaction history)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { character_id, direction, amount, title, note } = body;

    // Validate inputs
    if (!character_id) return Response.json({ error: 'character_id is required' }, { status: 400 });
    if (!direction || !['income', 'expense'].includes(direction)) {
      return Response.json({ error: 'direction must be "income" or "expense"' }, { status: 400 });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return Response.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    if (!title || !title.trim()) {
      return Response.json({ error: 'title is required' }, { status: 400 });
    }

    // Verify the character belongs to the authenticated user — ownership gate
    const characters = await base44.entities.Character.filter({ owner_email: user.email });
    const character = characters.find(c => c.id === character_id);
    if (!character) {
      return Response.json({ error: 'Character not found or not owned by this user' }, { status: 403 });
    }

    // Load the canonical financial record
    const financials = await base44.entities.CharacterFinancial.filter({ character_id });
    const financial = financials[0] || null;

    if (!financial) {
      return Response.json({ error: 'No CharacterFinancial record found for this character. Run finance initialization first.' }, { status: 404 });
    }

    // Ownership check on financial record
    const finOwner = financial.owner_email || financial.character_id;
    if (financial.owner_email && financial.owner_email !== user.email) {
      return Response.json({ error: 'Financial record does not belong to this user' }, { status: 403 });
    }

    const currentBalance = typeof financial.current_balance === 'number' ? financial.current_balance : 0;
    const newBalance = direction === 'income'
      ? currentBalance + parsedAmount
      : currentBalance - parsedAmount;

    const timestamp = new Date().toISOString();

    // Write the canonical transaction record
    const transaction = await base44.entities.FinancialTransaction.create({
      character_id: character.id,
      character_name: character.name,
      direction,
      amount: parsedAmount,
      transaction_type: 'other',
      description: note ? `${title.trim()} — ${note.trim()}` : title.trim(),
      balance_after: newBalance,
      timestamp,
      sender_type: 'user',
      sender_name: user.full_name || user.email,
    });

    // Update canonical balance on CharacterFinancial
    await base44.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      last_updated: timestamp,
    });

    return Response.json({
      success: true,
      character_name: character.name,
      direction,
      amount: parsedAmount,
      title: title.trim(),
      new_balance: newBalance,
      transaction_id: transaction.id,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});