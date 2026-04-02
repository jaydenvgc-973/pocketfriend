import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id, location_id, venue_type, amount, description } = await req.json();

    if (!character_id || !location_id || !amount) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get character financial record
    const financials = await base44.entities.CharacterFinancial.filter({
      character_id
    });

    if (!financials[0]) {
      return Response.json({ error: 'Financial record not found' }, { status: 404 });
    }

    const financial = financials[0];
    const newBalance = financial.current_balance - amount;
    const newTotalExpenses = financial.total_expenses + amount;

    // Add to recurring expenses or track as transaction
    const recurringExpenses = financial.recurring_expenses || [];
    const updatedExpenses = [
      ...recurringExpenses,
      {
        expense_type: 'custom',
        location_id,
        location_name: venue_type || 'Purchase',
        description: description || `Spending at ${venue_type}`,
        monthly_cost: amount,
        total_paid: amount,
        last_payment_date: new Date().toISOString()
      }
    ];

    await base44.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      total_expenses: newTotalExpenses,
      recurring_expenses: updatedExpenses
    });

    return Response.json({
      success: true,
      character_id,
      amount,
      description: description || `Spent at ${venue_type}`,
      previous_balance: financial.current_balance,
      new_balance: newBalance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});