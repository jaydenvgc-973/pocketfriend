import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processRecurringExpenses
 *
 * Runs on the 1st of each month (scheduled automation).
 * Processes ALL recurring expenses for all characters owned by the authenticated user.
 *
 * Covers:
 *   - recurring_expenses (location-tied: rent, utilities, groceries, gym, childcare)
 *   - other_monthly_expenses (personal: phone, car, etc.)
 *   - off-app rent ($3,000/mo) tracked as a recurring_expense with expense_type='rent'
 *     and description='Off-app living situation rent'
 *
 * Eviction rule for off-app rent:
 *   If balance < $3,000 when rent is due, character CANNOT pay. They are evicted:
 *   - housing_context → 'homeless_unsheltered'
 *   - is_homeless → true
 *   - current_home_location_id → null (cleared — the generated home is no longer valid)
 *   - The recurring rent expense is removed from their profile (no more rent until re-housed)
 *
 * Ownership: scoped by owner_email. created_by is FORBIDDEN.
 */

const OFF_APP_RENT_DESCRIPTION = 'Off-app living situation rent';
const OFF_APP_RENT_AMOUNT = 3000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only process on day 1 of each month (ET-aware) — unless catchUp=true is passed
    const body = await req.json().catch(() => ({}));
    const catchUp = body.catchUp === true;
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfMonth = nowET.getDate();
    if (dayOfMonth !== 1 && !catchUp) {
      return Response.json({ success: true, processedCount: 0, skipped: true, reason: 'Not the 1st of the month' });
    }

    const todayStr = nowET.toISOString().split('T')[0];
    const billingMonth = nowET.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });

    // Fetch all active characters owned by this user (owner_email is the source of truth)
    const characters = await base44.entities.Character.filter({
      owner_email: user.email,
      status: 'active',
    });

    const results = [];

    for (const character of characters) {
      try {
        const financialRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: character.id,
        });
        if (!financialRecs || financialRecs.length === 0) continue;

        let fin = financialRecs[0];
        const allExpenses = [
          ...(fin.recurring_expenses || []).map(e => ({ ...e, _source: 'recurring' })),
          ...(fin.other_monthly_expenses || []).map(e => ({ ...e, _source: 'other', expense_type: e.type || 'custom', description: e.name })),
        ];

        for (const expense of allExpenses) {
          const amount = expense.monthly_cost || expense.amount || 0;
          if (!amount) continue;

          const expenseLabel = expense.description || expense.name || expense.expense_type || 'Recurring Expense';

          // Dedup: skip if already posted today for this expense
          const existing = await base44.asServiceRole.entities.FinancialTransaction.filter({
            character_id: character.id,
            description: expenseLabel,
          });
          const alreadyPosted = existing.some(t => {
            if (!t.timestamp) return false;
            return t.timestamp.split('T')[0] === todayStr;
          });
          if (alreadyPosted) continue;

          // ── OFF-APP RENT: Eviction check ──────────────────────────────────────
          const isOffAppRent = expense.expense_type === 'rent' && expense.description === OFF_APP_RENT_DESCRIPTION;
          if (isOffAppRent) {
            const currentBalance = fin.current_balance || 0;

            if (currentBalance < OFF_APP_RENT_AMOUNT) {
              // Cannot afford rent → eviction
              console.log(`[processRecurringExpenses] ${character.name} cannot afford off-app rent ($${currentBalance} < $${OFF_APP_RENT_AMOUNT}) — EVICTING`);

              // Update character: homeless, clear home
              await base44.asServiceRole.entities.Character.update(character.id, {
                housing_context: 'homeless_unsheltered',
                is_homeless: true,
                current_home_location_id: null,
                temporary_housing_location_id: null,
                resolved_location_type: null,
                resolved_presence_status: null,
              });

              // Remove the off-app rent from recurring_expenses (no more charges until re-housed)
              const updatedRecurring = (fin.recurring_expenses || []).filter(
                e => !(e.expense_type === 'rent' && e.description === OFF_APP_RENT_DESCRIPTION)
              );
              await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
                recurring_expenses: updatedRecurring,
                last_updated: new Date().toISOString(),
              });
              fin = { ...fin, recurring_expenses: updatedRecurring };

              // Log eviction as a transaction record (no balance change — they simply can't pay)
              await base44.asServiceRole.entities.FinancialTransaction.create({
                character_id: character.id,
                character_name: character.name,
                sender_type: 'system',
                sender_name: 'Rent System',
                receiver_type: 'character',
                receiver_name: character.name,
                amount: 0,
                direction: 'expense',
                transaction_type: 'rent',
                description: `Off-app rent eviction — insufficient funds ($${currentBalance} available, $${OFF_APP_RENT_AMOUNT} required)`,
                timestamp: new Date().toISOString(),
                balance_after: currentBalance,
              });

              results.push({
                characterId: character.id,
                characterName: character.name,
                event: 'eviction',
                reason: 'insufficient_funds',
                balanceAvailable: currentBalance,
                rentRequired: OFF_APP_RENT_AMOUNT,
              });
              continue; // Do not charge
            }
          }
          // ──────────────────────────────────────────────────────────────────────

          // Normal charge
          const newBalance = Math.max(0, (fin.current_balance || 0) - amount);
          fin = { ...fin, current_balance: newBalance, total_expenses: (fin.total_expenses || 0) + amount };

          await base44.asServiceRole.entities.FinancialTransaction.create({
            character_id: character.id,
            character_name: character.name,
            sender_type: 'system',
            sender_name: 'Monthly Expense',
            receiver_type: 'character',
            receiver_name: character.name,
            amount,
            direction: 'expense',
            transaction_type: expense.expense_type || 'custom',
            description: expenseLabel,
            timestamp: new Date().toISOString(),
            balance_after: newBalance,
          });

          // Update financial record and mark last_payment_date on the expense entry
          if (expense._source === 'recurring') {
            const updatedRecurring = (fin.recurring_expenses || []).map(e =>
              (e.expense_type === expense.expense_type && e.description === expenseLabel)
                ? { ...e, last_payment_date: new Date().toISOString(), total_paid: (e.total_paid || 0) + amount }
                : e
            );
            await base44.asServiceRole.entities.CharacterFinancial.update(financialRecs[0].id, {
              current_balance: newBalance,
              total_expenses: fin.total_expenses,
              recurring_expenses: updatedRecurring,
              last_updated: new Date().toISOString(),
            });
            fin = { ...fin, recurring_expenses: updatedRecurring };
          } else {
            const updatedOther = (fin.other_monthly_expenses || []).map(e =>
              (e.name === expense.name || e.name === expenseLabel)
                ? { ...e, last_payment_date: new Date().toISOString(), total_paid: (e.total_paid || 0) + amount }
                : e
            );
            await base44.asServiceRole.entities.CharacterFinancial.update(financialRecs[0].id, {
              current_balance: newBalance,
              total_expenses: fin.total_expenses,
              other_monthly_expenses: updatedOther,
              last_updated: new Date().toISOString(),
            });
            fin = { ...fin, other_monthly_expenses: updatedOther };
          }

          results.push({
            characterId: character.id,
            characterName: character.name,
            expenseName: expenseLabel,
            amount,
            newBalance,
          });

          // Warn user if balance drops below $3,000 after any rent payment
          if (newBalance < OFF_APP_RENT_AMOUNT && isOffAppRent) {
            console.warn(`[processRecurringExpenses] ${character.name} balance ($${newBalance}) is below $${OFF_APP_RENT_AMOUNT} after off-app rent — will be evicted next month if not re-housed`);
          }
        }
      } catch (charErr) {
        console.error(`[processRecurringExpenses] Error processing character ${character.id}:`, charErr.message);
      }
    }

    return Response.json({
      success: true,
      processedCount: results.length,
      results,
    });
  } catch (error) {
    console.error('[processRecurringExpenses]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});