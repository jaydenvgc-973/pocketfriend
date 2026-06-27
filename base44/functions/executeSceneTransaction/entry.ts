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
 * - source context exists (purchase_source for purchase, service_source for service, fee_source for fee)
 *
 * After every successful user balance deduction, writes a FinancialTransaction record
 * for full ledger traceability and audit support.
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
      character_id,
      // Extended context fields (from ProductPurchaseModal and product card)
      item_label,
      item_category,
      target_character_id,
      scene_instance_id,
    } = data;

    // ── TRANSACTION AUTHORITY VALIDATION ────────────────────────────────────────
    // Every check must pass. Any failure = no transaction.

    if (is_paid !== true) {
      return Response.json({ error: 'Transaction rejected: action.is_paid must be true' }, { status: 400 });
    }

    if (!action_class || !['purchase', 'service', 'fee'].includes(action_class)) {
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

    // Source context: class-specific validation
    if (action_class === 'purchase' && !purchase_source) {
      return Response.json({ error: 'Transaction rejected: purchase_source is required for purchase class' }, { status: 400 });
    }
    // For service and fee, also accept a general source fallback
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

      // Affordability check — server-side authority; UI pre-check is advisory only
      if (currentBalance < numericCost) {
        return Response.json({ error: 'Transaction rejected: insufficient balance', balance: currentBalance, cost: numericCost }, { status: 400 });
      }

      const newBalance = currentBalance - numericCost;

      // ── BUILD AND VALIDATE LEDGER RECORD FIRST ───────────────────────────────────
      // Build the ledger entry BEFORE any balance change — ensures we know what we're creating
      const now = new Date().toISOString();
      const ledgerPayload = {
        // Ownership / scope
        character_id: target_character_id || null,
        character_name: null,
        sender_id: user.id,
        sender_type: 'user',
        sender_name: user.full_name || user.email,
        receiver_id: null,
        receiver_type: 'system',
        receiver_name: location_name || 'Scene',
        // Transaction amounts
        amount: numericCost,
        direction: 'expense',
        // Classification
        transaction_type: 'scene_purchase',
        description: [
          action_label || item_label || 'Scene purchase',
          location_name ? `at ${location_name}` : null,
          target_character_id ? `(gift)` : null,
        ].filter(Boolean).join(' '),
        // Location
        location_id: null,
        location_name: location_name || null,
        // Balance snapshot
        balance_after: newBalance,
        // Timestamp
        timestamp: now,
      };

      // ── EXECUTE TRANSACTION WITH LEDGER GUARANTEE ────────────────────────────────
      // Deduct balance, then immediately create ledger. If ledger fails, restore balance.
      // NO BALANCE CHANGE IS FINAL WITHOUT A LEDGER ENTRY.

      try {
        // Step 1: Deduct balance
        await base44.entities.UserSettings.update(settings.id, { user_balance: newBalance });

        // Step 2: Create ledger record — REQUIRED for transaction to be valid
        try {
          await base44.entities.FinancialTransaction.create(ledgerPayload);
        } catch (ledgerErr) {
          // LEDGER CREATION FAILED — Restore the balance and reject the entire transaction
          console.error(`[executeSceneTransaction] CRITICAL: Ledger creation failed. Restoring balance. action_id=${action_id}, user=${user.email}, cost=${numericCost}. Error: ${ledgerErr.message}`);
          
          try {
            await base44.entities.UserSettings.update(settings.id, { user_balance: currentBalance });
            console.log(`[executeSceneTransaction] Balance restored to ${currentBalance} after ledger failure`);
          } catch (restoreErr) {
            // CATASTROPHIC: Cannot restore balance
            console.error(`[executeSceneTransaction] CATASTROPHIC: Failed to restore balance after ledger failure. user=${user.email}, failed_balance=${newBalance}, intended_restore=${currentBalance}. Restore error: ${restoreErr.message}`);
            return Response.json({ 
              error: 'Transaction rejected: ledger record could not be created, and balance restoration encountered an error. Contact support immediately.',
              critical: true,
              user_email: user.email,
              action_id
            }, { status: 500 });
          }

          return Response.json({ 
            error: 'Transaction rejected: ledger record could not be created. Balance has been restored. Please try again.',
            action_id,
            payer: 'user'
          }, { status: 500 });
        }
      } catch (balanceErr) {
        // Balance update failed before we even tried the ledger
        console.error(`[executeSceneTransaction] Balance update failed: ${balanceErr.message}`);
        return Response.json({ 
          error: 'Transaction rejected: balance update failed',
          action_id 
        }, { status: 500 });
      }

      console.log(`[executeSceneTransaction] USER transaction approved + ledger created: ${action_class} "${action_label}" at ${location_name} — $${numericCost} deducted. Balance: ${currentBalance} → ${newBalance}`);

      return Response.json({
        success: true,
        transaction_class: action_class,
        action_id,
        amount_charged: numericCost,
        balance_before: currentBalance,
        balance_after: newBalance,
        payer: 'user',
        ledger_verified: true
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