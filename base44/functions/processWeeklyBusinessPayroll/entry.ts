import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

async function getOrCreateFinancial(base44, charId, charName, finCache) {
  if (finCache?.has(charId)) return finCache.get(charId);
  const recs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: charId });
  if (recs[0]) {
    finCache?.set(charId, recs[0]);
    return recs[0];
  }
  const created = await base44.asServiceRole.entities.CharacterFinancial.create({
    character_id: charId,
    character_name: charName,
    current_balance: 6000,
    total_income: 0,
    total_expenses: 0,
  });
  finCache?.set(charId, created);
  return created;
}

async function applyTransaction(base44, charId, charName, amount, direction, description, businessName, finCache) {
  const financial = await getOrCreateFinancial(base44, charId, charName, finCache);
  const currentBalance = financial.current_balance ?? 6000;
  const newBalance = direction === 'income' ? currentBalance + amount : currentBalance - amount;
  await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
    current_balance: newBalance,
    total_income: direction === 'income' ? (financial.total_income || 0) + amount : (financial.total_income || 0),
    total_expenses: direction === 'expense' ? (financial.total_expenses || 0) + amount : (financial.total_expenses || 0),
  });
  // Update in-memory cache so subsequent calls for the same character see the new balance (Pattern 9)
  financial.current_balance = newBalance;
  if (direction === 'income') financial.total_income = (financial.total_income || 0) + amount;
  else financial.total_expenses = (financial.total_expenses || 0) + amount;
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
    // In-memory cache for financial records — avoids re-fetching the same CharacterFinancial
    // record when a business owner has multiple employees (Pattern 9)
    const finCache = new Map();

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
              `Payroll: ${emp.character_name} (${business.name})`, business.name, finCache
            );
            // Credit the employee
            await applyTransaction(
              base44, emp.character_id, emp.character_name, weeklyPay, 'income',
              `Wages from ${business.name} (${char.name})`, business.name, finCache
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
              `Weekly payment from ${business.name}`, business.name, finCache
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