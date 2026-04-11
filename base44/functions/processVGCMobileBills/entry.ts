/**
 * processVGCMobileBills
 *
 * Processes monthly VGC Mobile phone bills for all active characters.
 * Dual-ledger: character gets an expense, user gets matching income.
 * Characters remain unaware the user owns VGC Mobile.
 *
 * Called by a scheduled automation (monthly on day 1).
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date().toISOString();

  // Get all active characters belonging to this user
  const characters = await base44.asServiceRole.entities.Character.filter({
    created_by: user.email,
    status: 'active',
  });

  // Get user financial records
  const userSettingsList = await base44.asServiceRole.entities.UserSettings.list();
  const userSettings = userSettingsList[0];
  if (!userSettings) return Response.json({ error: 'No user settings found' }, { status: 404 });

  const results = [];

  for (const char of characters) {
    // Get or default phone bill amount from CharacterFinancial
    const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
    const financial = financials[0];
    if (!financial) continue;

    // Find VGC Mobile bill in other_monthly_expenses
    const phoneBillExpense = (financial.other_monthly_expenses || []).find(
      e => e.name?.toLowerCase().includes('vgc mobile') || (e.type === 'cell_phone' && e.name?.toLowerCase().includes('vgc'))
    );
    const billAmount = phoneBillExpense?.amount || 80; // default $80

    // Deduct from character balance
    const newCharBalance = (financial.current_balance || 0) - billAmount;
    const newTotalExpenses = (financial.total_expenses || 0) + billAmount;

    // Update other_monthly_expenses total_paid
    const updatedExpenses = (financial.other_monthly_expenses || []).map(e => {
      if (e.name?.toLowerCase().includes('vgc mobile') || (e.type === 'cell_phone' && e.name?.toLowerCase().includes('vgc'))) {
        return { ...e, total_paid: (e.total_paid || 0) + billAmount, last_payment_date: now };
      }
      return e;
    });

    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      current_balance: newCharBalance,
      total_expenses: newTotalExpenses,
      other_monthly_expenses: updatedExpenses,
    });

    // Log character expense transaction
    await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id: char.id,
      character_name: char.name,
      sender_id: char.id,
      sender_type: 'character',
      sender_name: char.name,
      receiver_id: 'vgc_mobile',
      receiver_type: 'system',
      receiver_name: 'VGC Mobile',
      amount: billAmount,
      direction: 'expense',
      transaction_type: 'utilities',
      description: `VGC Mobile - Monthly Phone Bill`,
      balance_after: newCharBalance,
      timestamp: now,
    });

    // Add income to user balance
    const newUserBalance = (userSettings.user_balance || 6000) + billAmount;
    await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
      user_balance: newUserBalance,
    });

    // Log user income transaction
    await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id: 'user',
      character_name: user.full_name || 'Player',
      sender_id: char.id,
      sender_type: 'character',
      sender_name: char.name,
      receiver_id: user.id,
      receiver_type: 'user',
      receiver_name: user.full_name || 'Player',
      amount: billAmount,
      direction: 'income',
      transaction_type: 'income',
      description: `VGC Mobile - Customer Payment from ${char.name}`,
      balance_after: newUserBalance,
      timestamp: now,
    });

    results.push({ character: char.name, amount: billAmount, newCharBalance, newUserBalance });
  }

  return Response.json({ processed: results.length, results });
});