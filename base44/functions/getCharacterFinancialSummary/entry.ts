import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id } = await req.json();

    if (!character_id) {
      return Response.json({ error: 'Missing character_id' }, { status: 400 });
    }

    // Get character
    const chars = await base44.entities.Character.filter({ id: character_id });
    if (!chars[0]) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const character = chars[0];

    // Get financial record.
    // CANONICAL LOOKUP: filter by character_id + owner_email to avoid reading
    // owner_email:null duplicate shells. Fall back to character_id-only if no
    // owner-scoped record exists (legacy compatibility).
    let financials = await base44.entities.CharacterFinancial.filter(
      { character_id, owner_email: character.owner_email },
      '-created_date',
      1
    );
    if (!financials.length) {
      // Legacy fallback: no owner-scoped record — read any record for this character
      financials = await base44.entities.CharacterFinancial.filter(
        { character_id },
        '-created_date',
        1
      );
    }

    if (!financials[0]) {
      return Response.json({
        error: 'CharacterFinancial record not found',
        status: 'no_record'
      }, { status: 404 });
    }

    const financial = financials[0];
    const incomeSources = financial.income_sources || [];
    const recurringExpenses = financial.recurring_expenses || [];

    // Calculate monthly metrics
    const monthlyIncome = incomeSources.reduce((sum, source) => sum + (source.pay_amount || 0), 0) * 2; // Bi-weekly * 2
    const monthlyExpenses = recurringExpenses
      .filter(e => ['rent', 'utilities', 'groceries', 'gym', 'phone', 'streaming'].includes(e.expense_type))
      .reduce((sum, exp) => sum + (exp.monthly_cost || 0), 0);

    return Response.json({
      character_id,
      character_name: character.name,
      current_balance: financial.current_balance,
      total_income: financial.total_income,
      total_expenses: financial.total_expenses,
      monthly_income: Math.round(monthlyIncome * 100) / 100,
      monthly_expenses: Math.round(monthlyExpenses * 100) / 100,
      net_monthly: Math.round((monthlyIncome - monthlyExpenses) * 100) / 100,
      income_sources: incomeSources,
      recurring_expenses: recurringExpenses,
      last_updated: financial.last_updated
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});