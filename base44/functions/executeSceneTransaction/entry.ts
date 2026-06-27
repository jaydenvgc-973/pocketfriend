/**
 * executeSceneTransaction — Scene Transaction Authority
 *
 * The ONLY function that may update user or character balances for Scene actions.
 * All Scene UI code must route through this function. Direct balance updates in UI are forbidden.
 *
 * Validates ALL of the following before any deduction:
 * - action is explicitly paid (is_paid === true)
 * - action_class is 'purchase', 'service', or 'fee'
 * - cost is a real positive number (no invented, fallback, or random prices)
 * - payer is explicitly defined
 * - action_id exists
 * - source context exists (purchase_source, service_source, or fee_source)
 *
 * Rejects any transaction that does not meet ALL criteria.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const data = await req.json();
    const {
      action_class,
      is_paid,
      cost,
      payer_type,
      action_id,
      purchase_source,
      service_source,
      fee_source,
      action_label,
      location_name,
      character_id
    } = data;

    // ── TRANSACTION AUTHORITY VALIDATION ────────────────────────────────────────
    // Every check must pass. Any failure = no transaction.

    if (is_paid !== true) {
      return Response.json({ error: 'Transaction rejected: action.is_paid must be true' }, { status: 400 });
    }

    if (!['purchase', 'service', 'fee'].includes(action_class)) {
      return Response.json({ error: `Transaction rejected: invalid action_class "${action_class}". Only purchase, service, or fee may be paid.` }, { status: 400 });
    }

    const numericCost = Number(cost);
    if (!numericCost || numericCost <= 0 || !isFinite(numericCost)) {
      return Response.json({ error: 'Transaction rejected: cost must be a real positive number' }, { status: 400 });
    }

    if (!payer_type) {
      return Response.json({ error: 'Transaction rejected: payer_type is required' }, { status: 400 });
    }

    if (!action_id) {
      return Response.json({ error: 'Transaction rejected: action_id is required' }, { status: 400 });
    }

    // Source context: at least one of purchase_source, service_source, fee_source must exist
    const hasSource = purchase_source || service_source || fee_source;
    if (!hasSource) {
      return Response.json({ error: 'Transaction rejected: source context required (purchase_source, service_source, or fee_source)' }, { status: 400 });
    }

    // ── EXECUTE TRANSACTION ──────────────────────────────────────────────────────

    if (payer_type === 'user') {
      // Fetch user settings scoped to authenticated user only
      const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email });
      const settings = settingsList[0];
      if (!settings) {
        return Response.json({ error: 'User settings not found' }, { status: 404 });
      }

      const currentBalance = typeof settings.user_balance === 'number' ? settings.user_balance : 6000;
      const newBalance = Math.max(0, currentBalance - numericCost);

      await base44.entities.UserSettings.update(settings.id, { user_balance: newBalance });

      console.log(`[executeSceneTransaction] USER transaction approved: ${action_class} "${action_label}" at ${location_name} — $${numericCost} deducted. Balance: ${currentBalance} → ${newBalance}`);

      return Response.json({
        success: true,
        transaction_class: action_class,
        action_id,
        amount_charged: numericCost,
        balance_before: currentBalance,
        balance_after: newBalance,
        payer: 'user'
      });

    } else if (payer_type === 'character' && character_id) {
      // Character pays — delegate to existing expense function
      await base44.functions.invoke('calculateCharacterExpenses', {
        characterId: character_id,
        expenseAmount: numericCost,
        expenseLabel: action_label || `Scene ${action_class}`
      });

      console.log(`[executeSceneTransaction] CHARACTER transaction approved: ${action_class} "${action_label}" — character ${character_id} charged $${numericCost}`);

      return Response.json({
        success: true,
        transaction_class: action_class,
        action_id,
        amount_charged: numericCost,
        payer: 'character',
        character_id
      });
    }

    return Response.json({ error: 'Unknown payer_type — must be "user" or "character"' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});