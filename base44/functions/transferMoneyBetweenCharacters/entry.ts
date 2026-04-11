/**
 * transferMoneyBetweenCharacters
 *
 * Handles borrowing (loan) and gifting between characters, or from user to character.
 *
 * Payload:
 *   from_type: 'character' | 'user'
 *   from_id: character_id OR 'user'
 *   to_character_id: string
 *   amount: number
 *   transfer_type: 'loan' | 'gift'
 *   note: string (optional)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { from_type, from_id, to_character_id, amount, transfer_type, note } = body;

  if (!to_character_id || !amount || amount <= 0) {
    return Response.json({ error: 'Missing required fields: to_character_id, amount' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const typeLabel = transfer_type === 'loan' ? 'Loan' : 'Gift';

  // ── RECEIVER (always a character) ────────────────────────────────────────
  const toFinancials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: to_character_id });
  const toFinancial = toFinancials[0];
  const toChars = await base44.asServiceRole.entities.Character.filter({ id: to_character_id });
  const toChar = toChars[0];
  if (!toFinancial || !toChar) return Response.json({ error: 'Receiver character not found' }, { status: 404 });

  const newToBalance = (toFinancial.current_balance || 0) + amount;
  const newToIncome = (toFinancial.total_income || 0) + amount;

  await base44.asServiceRole.entities.CharacterFinancial.update(toFinancial.id, {
    current_balance: newToBalance,
    total_income: newToIncome,
  });

  await base44.asServiceRole.entities.FinancialTransaction.create({
    character_id: to_character_id,
    character_name: toChar.name,
    sender_id: from_id,
    sender_type: from_type,
    sender_name: from_type === 'user' ? (user.full_name || 'Player') : from_id,
    receiver_id: to_character_id,
    receiver_type: 'character',
    receiver_name: toChar.name,
    amount,
    direction: 'income',
    transaction_type: transfer_type === 'loan' ? 'loan' : 'gift',
    description: note || `${typeLabel} received${from_type === 'user' ? ' from Player' : ''}`,
    balance_after: newToBalance,
    timestamp: now,
  });

  // ── SENDER ────────────────────────────────────────────────────────────────
  if (from_type === 'user') {
    // Deduct from user balance
    const userSettingsList = await base44.asServiceRole.entities.UserSettings.list();
    const userSettings = userSettingsList[0];
    if (!userSettings) return Response.json({ error: 'User settings not found' }, { status: 404 });

    const newUserBalance = (userSettings.user_balance || 6000) - amount;
    await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
      user_balance: newUserBalance,
    });

    // Log user outgoing
    await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id: 'user',
      character_name: user.full_name || 'Player',
      sender_id: user.id,
      sender_type: 'user',
      sender_name: user.full_name || 'Player',
      receiver_id: to_character_id,
      receiver_type: 'character',
      receiver_name: toChar.name,
      amount,
      direction: 'expense',
      transaction_type: transfer_type === 'loan' ? 'loan' : 'gift',
      description: note || `${typeLabel} sent to ${toChar.name}`,
      balance_after: newUserBalance,
      timestamp: now,
    });
  } else {
    // Deduct from sending character
    const fromFinancials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: from_id });
    const fromFinancial = fromFinancials[0];
    const fromChars = await base44.asServiceRole.entities.Character.filter({ id: from_id });
    const fromChar = fromChars[0];

    if (fromFinancial && fromChar) {
      const newFromBalance = (fromFinancial.current_balance || 0) - amount;
      const newFromExpenses = (fromFinancial.total_expenses || 0) + amount;
      await base44.asServiceRole.entities.CharacterFinancial.update(fromFinancial.id, {
        current_balance: newFromBalance,
        total_expenses: newFromExpenses,
      });

      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: from_id,
        character_name: fromChar.name,
        sender_id: from_id,
        sender_type: 'character',
        sender_name: fromChar.name,
        receiver_id: to_character_id,
        receiver_type: 'character',
        receiver_name: toChar.name,
        amount,
        direction: 'expense',
        transaction_type: transfer_type === 'loan' ? 'loan' : 'gift',
        description: note || `${typeLabel} sent to ${toChar.name}`,
        balance_after: newFromBalance,
        timestamp: now,
      });

      // Memory: relationship-based — who helped
      await base44.asServiceRole.entities.Memory.create({
        character_id: to_character_id,
        title: `${fromChar.name} helped with money`,
        description: `${fromChar.name} gave ${toChar.name} $${amount} as a ${transfer_type}. ${note || ''}`,
        emotional_impact: transfer_type === 'loan' ? 'grateful but aware of the obligation to repay' : 'touched and deeply grateful',
        lesson_learned: 'Some people show up when you need them most.',
        timestamp: now,
      });
    }
  }

  return Response.json({ success: true, amount, transfer_type, to: toChar.name });
});