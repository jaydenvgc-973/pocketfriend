import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    const char = await base44.entities.Character.get(characterId);
    let financial = (await base44.entities.CharacterFinancial.filter({ character_id: characterId }))[0];
    
    if (!financial) {
      financial = await base44.entities.CharacterFinancial.create({
        character_id: characterId,
        character_name: char.name,
        current_balance: 6000,
        total_income: 0,
        total_expenses: 0,
      });
    }

    const businesses = char.businesses || [];
    const txns = await base44.entities.FinancialTransaction.filter({ character_id: characterId }, '-timestamp', 100);

    const diagnostics = {
      characterName: char.name,
      characterId,
      hasFinancialRecord: !!financial,
      currentBalance: financial.current_balance,
      totalIncome: financial.total_income,
      totalExpenses: financial.total_expenses,
      businessCount: businesses.length,
      businesses: businesses.map(b => ({
        id: b.id,
        name: b.name,
        income: b.income,
        workerIds: b.worker_character_ids || [],
      })),
      recentTransactions: txns.slice(0, 10).map(t => ({
        id: t.id,
        type: t.transaction_type,
        amount: t.amount,
        direction: t.direction,
        description: t.description,
        timestamp: t.timestamp,
      })),
      businessRelatedTransactions: txns.filter(t => 
        t.description && (t.description.includes('Business') || t.description.includes('business'))
      ).map(t => ({
        id: t.id,
        type: t.transaction_type,
        amount: t.amount,
        direction: t.direction,
        description: t.description,
        timestamp: t.timestamp,
      })),
    };

    return Response.json(diagnostics);
  } catch (error) {
    console.error('Diagnostic error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});