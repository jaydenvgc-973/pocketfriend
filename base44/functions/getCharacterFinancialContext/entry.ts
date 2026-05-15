/**
 * getCharacterFinancialContext
 *
 * Returns a lightweight financial awareness context for a character:
 * - current_balance (from CharacterFinancial — canonical source)
 * - recent_transactions (last 10 from FinancialTransaction)
 * - account_status
 *
 * Used by the chat prompt builder to inject real financial state when
 * the conversation touches money, spending, or affordability.
 *
 * Does NOT invent balances. If no record exists, returns no_record status.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id } = await req.json();
    if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

    // Load canonical financial record + recent transactions in parallel
    // Fetches 15 most recent transactions across ALL charge types (rent, food, venue, payroll, etc.)
    const [finRecords, recentTxns] = await Promise.all([
      base44.entities.CharacterFinancial.filter({ character_id }, null, 1),
      base44.entities.FinancialTransaction.filter({ character_id }, '-timestamp', 15),
    ]);

    const financial = finRecords[0];

    if (!financial) {
      return Response.json({
        account_status: 'no_record',
        current_balance: null,
        recent_transactions: [],
        context_block: '',
      });
    }

    const balance = typeof financial.current_balance === 'number' ? financial.current_balance : null;

    // Human-readable labels for all known transaction types
    const TYPE_LABELS = {
      rent: 'Rent',
      utilities: 'Utilities',
      groceries: 'Grocery / Food',
      gym: 'Gym Membership',
      childcare: 'Childcare',
      custom: 'Payment',
      bar_restaurant: 'Restaurant / Bar',
      entertainment: 'Entertainment',
      transport: 'Transport',
      clothing: 'Clothing',
      healthcare: 'Healthcare',
      payroll: 'Paycheck',
      income: 'Income',
      gift: 'Gift',
      loan: 'Loan',
      repayment: 'Repayment',
      purchase: 'Purchase',
      tuition: 'Tuition',
      simulated_need: 'Personal Expense',
      scene_purchase: 'Scene Purchase',
      other: 'Other',
    };

    // Build readable transaction list — hides raw internal keys (idempotency keys, system codes)
    // Display title priority: location_name → type label → transaction_type raw
    // Hidden metadata (initiated_by, sender identity for hidden transactions) is NOT included
    const txnSummaries = recentTxns.map(t => {
      // Never expose raw idempotency keys (they start with "venue_")
      const rawDesc = t.description || '';
      const isInternalKey = rawDesc.startsWith('venue_') || rawDesc.startsWith('system_') || rawDesc.startsWith('auto_');
      const displayTitle = t.location_name
        || (isInternalKey ? null : rawDesc)
        || TYPE_LABELS[t.transaction_type]
        || t.transaction_type
        || 'Transaction';
      return {
        title: displayTitle,
        amount: t.direction === 'expense' ? -(t.amount) : t.amount,
        category: TYPE_LABELS[t.transaction_type] || t.transaction_type || 'other',
        date: t.timestamp ? t.timestamp.split('T')[0] : null,
      };
    });

    // Build the injectable context string
    let contextLines = [];
    if (balance !== null) {
      const fmt = balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      contextLines.push(`YOUR REAL ACCOUNT BALANCE: $${fmt}`);
      if (balance < 500) {
        contextLines.push(`FINANCIAL STATE: Balance is critically low ($${fmt}). You are aware of this and it affects your decisions.`);
      } else if (balance < 2000) {
        contextLines.push(`FINANCIAL STATE: Balance is on the lower side ($${fmt}). You are being careful about spending.`);
      } else {
        contextLines.push(`FINANCIAL STATE: You have funds available. You are NOT broke. Do NOT say or imply you have $0 or cannot afford basics.`);
      }
    }

    if (txnSummaries.length > 0) {
      const txnLines = txnSummaries.map(t => {
        const sign = t.amount >= 0 ? '+' : '';
        return `  • ${t.title}: ${sign}$${Math.abs(t.amount).toFixed(2)} (${t.category})`;
      }).join('\n');
      contextLines.push(`YOUR RECENT STATEMENT ACTIVITY (across all charge types — rent, food, bills, venue spending, income, transfers):\n${txnLines}\nIMPORTANT: For any "hidden TAKE" or anonymous transfer, you can see the statement title and amount but NOT who initiated it. Do NOT reveal hidden sender identity unless your character has discovered it through in-world means.`);
    }

    contextLines.push(`SUSPICIOUS TRANSACTION RULE: If a transaction amount seems unrealistic for that venue (e.g. $1,000 at McDonald's), you may notice it and react naturally — express confusion, check your account, wonder if something is wrong. Do NOT automatically accuse anyone unless discovery logic supports it.`);
    contextLines.push(`FALSE BROKE RULE: Never say you have $0, are broke, or cannot afford something if your real balance shows otherwise. Your personality may make you frugal or cautious, but you must not be factually wrong about your financial state.`);

    const contextBlock = contextLines.length > 0
      ? `\n\nFINANCIAL AWARENESS (REAL DATA — NOT INVENTED):\n${contextLines.join('\n\n')}`
      : '';

    return Response.json({
      account_status: 'active',
      current_balance: balance,
      recent_transactions: txnSummaries,
      context_block: contextBlock,
    });
  } catch (err) {
    console.error('[getCharacterFinancialContext]', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});