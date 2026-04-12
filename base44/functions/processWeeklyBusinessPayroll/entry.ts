import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

async function getOrCreateFinancial(base44, charId, charName) {
  const recs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: charId });
  if (recs[0]) return recs[0];
  return base44.asServiceRole.entities.CharacterFinancial.create({
    character_id: charId,
    character_name: charName,
    current_balance: 6000,
    total_income: 0,
    total_expenses: 0,
  });
}

async function applyTransaction(base44, charId, charName, amount, direction, description, businessName) {
  const financial = await getOrCreateFinancial(base44, charId, charName);
  const currentBalance = financial.current_balance ?? 6000;
  const newBalance = direction === 'income' ? currentBalance + amount : currentBalance - amount;
  await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
    current_balance: newBalance,
    total_income: direction === 'income' ? (financial.total_income || 0) + amount : (financial.total_income || 0),
    total_expenses: direction === 'expense' ? (financial.total_expenses || 0) + amount : (financial.total_expenses || 0),
  });
  await base44.asServiceRole.entities.FinancialTransaction.create({
    character_id: charId,
    character_name: charName,
    sender_type: direction === 'income' ? 'system' : 'character',
    sender_name: direction === 'income' ? businessName : charName,
    receiver_type: direction === 'income' ? 'character' : 'system',
    receiver_name: direction === 'income' ? charName : businessName,
    amount,
    direction,
    transaction_type: 'payroll',
    description,
    timestamp: new Date().toISOString(),
    balance_after: newBalance,
  });
  return newBalance;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active' }, null, 1000
    );
    const charMap = {};
    for (const c of allChars) charMap[c.id] = c;

    let processed = 0;
    let failed = 0;

    for (const char of allChars) {
      const businesses = char.businesses || [];
      for (const business of businesses) {
        const employees = business.employees || [];
        if (employees.length === 0) continue;

        for (const emp of employees) {
          if (!emp.pay_rate || emp.pay_rate <= 0) continue;
          const empChar = charMap[emp.character_id];
          if (!empChar) continue;

          // Weekly amount: monthly / 4.33, hourly * 40hrs/wk
          const weeklyPay = emp.pay_type === 'hourly'
            ? emp.pay_rate * 40
            : emp.pay_rate / 4.33;

          try {
            // Deduct from business owner
            await applyTransaction(
              base44, char.id, char.name, weeklyPay, 'expense',
              `Payroll: ${emp.character_name} (${business.name})`, business.name
            );
            // Credit the employee
            await applyTransaction(
              base44, emp.character_id, emp.character_name, weeklyPay, 'income',
              `Wages from ${business.name} (${char.name})`, business.name
            );
            processed++;
          } catch (err) {
            console.error(`Payroll failed: ${char.name} -> ${emp.character_name}:`, err.message);
            failed++;
          }
        }

        // Legacy: monthly_worker_pay (owner income only)
        if (business.monthly_worker_pay && business.monthly_worker_pay > 0 && employees.length === 0) {
          const weeklyAmount = business.monthly_worker_pay / 4.33;
          try {
            await applyTransaction(
              base44, char.id, char.name, weeklyAmount, 'income',
              `Weekly payment from ${business.name}`, business.name
            );
            processed++;
          } catch (err) {
            console.error(`Legacy payroll failed for ${char.name} - ${business.name}:`, err.message);
            failed++;
          }
        }
      }
    }

    return Response.json({ success: true, processed, failed });
  } catch (error) {
    console.error('[processWeeklyBusinessPayroll]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});