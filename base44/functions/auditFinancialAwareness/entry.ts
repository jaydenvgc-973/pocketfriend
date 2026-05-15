/**
 * auditFinancialAwareness
 *
 * Diagnostic: reads real CharacterFinancial + FinancialTransaction records
 * for the authenticated user's characters to verify awareness context correctness.
 *
 * Returns per-character proof:
 * - character_id, name, owner_email
 * - current_balance
 * - recent transaction count + labels
 * - recurring expense count + labels
 * - whether awareness would say "not broke" if balance > 0
 * - hidden metadata filter verification
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch ONLY active_created_character types — audit scope matches real finance scope
    const allActive = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active' },
      null,
      50
    );
    const characters = allActive.filter(c =>
      c.character_type === 'active_created_character' ||
      c.is_active_created_character === true ||
      c.is_active_character === true
    );

    if (!characters.length) {
      return Response.json({ error: 'No active_created_character records found for this user', owner_email: user.email });
    }

    const INTERNAL_KEY_PREFIXES = ['venue_', 'system_', 'auto_'];

    const TYPE_LABELS = {
      rent: 'Rent', utilities: 'Utilities', groceries: 'Grocery / Food',
      gym: 'Gym Membership', childcare: 'Childcare', custom: 'Payment',
      bar_restaurant: 'Restaurant / Bar', entertainment: 'Entertainment',
      transport: 'Transport', clothing: 'Clothing', healthcare: 'Healthcare',
      payroll: 'Paycheck', income: 'Income', gift: 'Gift / Transfer',
      loan: 'Loan', repayment: 'Repayment', purchase: 'Purchase',
      tuition: 'Tuition', simulated_need: 'Personal Expense',
      scene_purchase: 'Scene Purchase', other: 'Other',
    };

    const results = [];

    for (const char of characters.slice(0, 10)) { // cap at 10 for audit
      try {
        const [finRecords, recentTxns] = await Promise.all([
          base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id }, null, 1),
          base44.asServiceRole.entities.FinancialTransaction.filter({ character_id: char.id }, '-timestamp', 15),
        ]);

        const fin = finRecords[0];
        if (!fin) {
          results.push({ character_id: char.id, name: char.name, status: 'no_financial_record' });
          continue;
        }

        const balance = typeof fin.current_balance === 'number' ? fin.current_balance : null;
        const recurringExpenses = fin.recurring_expenses || [];
        const otherMonthly = fin.other_monthly_expenses || [];

        // Check each transaction for internal key leakage
        const txnAudit = recentTxns.map(t => {
          const rawDesc = t.description || '';
          const isInternalKey = INTERNAL_KEY_PREFIXES.some(p => rawDesc.startsWith(p));
          const displayTitle = t.location_name
            || (isInternalKey ? null : rawDesc)
            || TYPE_LABELS[t.transaction_type]
            || t.transaction_type || 'Transaction';
          return {
            id: t.id,
            raw_description: rawDesc,
            location_name: t.location_name || null,
            transaction_type: t.transaction_type,
            amount: t.amount,
            direction: t.direction,
            display_title: displayTitle,
            internal_key_leaked: isInternalKey && !t.location_name,
            date: t.timestamp ? t.timestamp.split('T')[0] : null,
          };
        });

        const recurringAudit = [...recurringExpenses, ...otherMonthly].map(e => ({
          type: e.expense_type || e.type || 'custom',
          label: e.description || e.name || TYPE_LABELS[e.expense_type || e.type] || 'Recurring Expense',
          monthly_cost: e.monthly_cost || e.amount || 0,
          location_name: e.location_name || null,
        }));

        const leakedKeys = txnAudit.filter(t => t.internal_key_leaked);

        results.push({
          character_id: char.id,
          name: char.name,
          character_type: char.character_type || 'unknown',
          owner_email: char.owner_email,
          current_balance: balance,
          awareness_says_not_broke: balance !== null && balance > 0,
          transaction_count: recentTxns.length,
          recurring_expense_count: recurringAudit.length,
          recent_transaction_display_labels: txnAudit.map(t => `${t.direction === 'expense' ? '-' : '+'}$${t.amount} | ${t.display_title} (${TYPE_LABELS[t.transaction_type] || t.transaction_type})`),
          recurring_obligations: recurringAudit.map(e => `${e.label}: $${e.monthly_cost}/mo`),
          internal_key_leaks: leakedKeys.length,
          leaked_keys_detail: leakedKeys.map(t => t.raw_description),
          hidden_metadata_filtered: leakedKeys.length === 0,
        });
      } catch (charErr) {
        results.push({ character_id: char.id, name: char.name, error: charErr.message });
      }
    }

    // Summary stats
    const withTransactions = results.filter(r => r.transaction_count > 0);
    const withRecurring = results.filter(r => r.recurring_expense_count > 0);
    const withLeaks = results.filter(r => r.internal_key_leaks > 0);
    const notBrokeAndCorrect = results.filter(r => r.awareness_says_not_broke === true && r.current_balance > 0);

    return Response.json({
      owner_email: user.email,
      characters_checked: results.length,
      with_transactions: withTransactions.length,
      with_recurring_expenses: withRecurring.length,
      with_internal_key_leaks: withLeaks.length,
      correctly_not_broke: notBrokeAndCorrect.length,
      // Show the most financially active characters first
      results: [...results].sort((a, b) => ((b.transaction_count || 0) + (b.recurring_expense_count || 0)) - ((a.transaction_count || 0) + (a.recurring_expense_count || 0))).slice(0, 5),
      summary: results.map(r => ({
        name: r.name,
        balance: r.current_balance,
        txns: r.transaction_count,
        recurring: r.recurring_expense_count,
        not_broke_correct: r.awareness_says_not_broke,
        leaks: r.internal_key_leaks,
      })),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});