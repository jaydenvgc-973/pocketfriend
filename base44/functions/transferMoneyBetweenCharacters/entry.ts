/**
 * transferMoneyBetweenCharacters
 *
 * Handles borrowing (loan), gifting, and repayments between characters,
 * or from user to character. All character types are financially eligible
 * for interpersonal transfers. Active-created-only restriction applies only
 * to autonomous spending processors, NOT this function.
 *
 * Payload:
 *   from_type: 'character' | 'user'
 *   from_id: character_id OR 'user'
 *   to_character_id: string
 *   amount: number
 *   transfer_type: 'loan' | 'gift' | 'repayment'
 *   note: string (optional)
 *
 * Transaction types used:
 *   loan → character_loan_given (sender) + character_loan_received (receiver)
 *   repayment → character_loan_repayment (both sides)
 *   gift → gift (both sides)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

  // ── RESOLVE TRANSACTION TYPE LABELS ────────────────────────────────────────
  // Supports: loan, repayment, gift — all available to any character type
  const isLoan = transfer_type === 'loan';
  const isRepayment = transfer_type === 'repayment';
  const isGift = !isLoan && !isRepayment;

  const senderTxnType = isLoan ? 'character_loan_given'
    : isRepayment ? 'character_loan_repayment'
    : 'gift';
  const receiverTxnType = isLoan ? 'character_loan_received'
    : isRepayment ? 'character_loan_repayment'
    : 'gift';

  const typeLabel = isLoan ? 'Loan' : isRepayment ? 'Repayment' : 'Gift';

  // ── RECEIVER (always a character) ────────────────────────────────────────
  // No character_type restriction — all financially-enabled characters can receive transfers
  const toFinancials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: to_character_id });
  const toFinancial = toFinancials[0];
  // Use user-scoped query first (respects RLS), fall back to service role for NPCs
  let toCharResults = await base44.entities.Character.filter({ id: to_character_id });
  if (!toCharResults?.length) {
    toCharResults = await base44.asServiceRole.entities.Character.filter({ id: to_character_id });
  }
  const toChar = toCharResults[0];
  if (!toChar) return Response.json({ error: 'Receiver character not found' }, { status: 404 });

  const toCurrentBalance = toFinancial ? (toFinancial.current_balance || 0) : 6000;
  const newToBalance = toCurrentBalance + amount;

  if (toFinancial) {
    await base44.asServiceRole.entities.CharacterFinancial.update(toFinancial.id, {
      current_balance: newToBalance,
      total_income: (toFinancial.total_income || 0) + amount,
    });
  } else {
    // Auto-create reserve record for financially-enabled but not-yet-initialized characters
    await base44.asServiceRole.entities.CharacterFinancial.create({
      character_id: to_character_id,
      character_name: toChar.name,
      current_balance: newToBalance,
      total_income: amount,
      total_expenses: 0,
    });
  }

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
    transaction_type: receiverTxnType,
    description: note || `${typeLabel} received${from_type === 'user' ? ' from Player' : ''}`,
    balance_after: newToBalance,
    loan_counterpart_id: from_type === 'character' ? from_id : null,
    loan_counterpart_name: from_type === 'character' ? from_id : (user.full_name || 'Player'),
    loan_status: isLoan ? 'outstanding' : null,
    loan_original_amount: isLoan ? amount : null,
    timestamp: now,
  });

  // ── SENDER ────────────────────────────────────────────────────────────────
  if (from_type === 'user') {
    // Deduct from user balance
    const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: user.email }, null, 1);
    const userSettings = userSettingsList[0];
    if (!userSettings) return Response.json({ error: 'User settings not found' }, { status: 404 });

    const newUserBalance = (userSettings.user_balance || 6000) - amount;
    await base44.asServiceRole.entities.UserSettings.update(userSettings.id, {
      user_balance: newUserBalance,
    });

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
      transaction_type: senderTxnType,
      description: note || `${typeLabel} sent to ${toChar.name}`,
      balance_after: newUserBalance,
      loan_counterpart_id: to_character_id,
      loan_counterpart_name: toChar.name,
      loan_status: isLoan ? 'outstanding' : null,
      loan_original_amount: isLoan ? amount : null,
      timestamp: now,
    });
  } else {
    // Deduct from sending character — no character_type restriction
    const fromFinancials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: from_id });
    const fromFinancial = fromFinancials[0];
    let fromCharResults = await base44.entities.Character.filter({ id: from_id });
    if (!fromCharResults?.length) {
      fromCharResults = await base44.asServiceRole.entities.Character.filter({ id: from_id });
    }
    const fromChar = fromCharResults[0];

    if (fromChar) {
      const fromCurrentBalance = fromFinancial ? (fromFinancial.current_balance || 0) : 6000;
      const newFromBalance = fromCurrentBalance - amount;

      if (fromFinancial) {
        await base44.asServiceRole.entities.CharacterFinancial.update(fromFinancial.id, {
          current_balance: newFromBalance,
          total_expenses: (fromFinancial.total_expenses || 0) + amount,
        });
      } else {
        await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: from_id,
          character_name: fromChar.name,
          current_balance: newFromBalance,
          total_income: 0,
          total_expenses: amount,
        });
      }

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
        transaction_type: senderTxnType,
        description: note || `${typeLabel} sent to ${toChar.name}`,
        balance_after: newFromBalance,
        loan_counterpart_id: to_character_id,
        loan_counterpart_name: toChar.name,
        loan_status: isLoan ? 'outstanding' : null,
        loan_original_amount: isLoan ? amount : null,
        timestamp: now,
      });

      // Memory for the receiver (relational — who helped)
      const memoryText = isLoan
        ? `${fromChar.name} lent $${amount} to ${toChar.name}. ${note || ''}`
        : isRepayment
          ? `${fromChar.name} repaid $${amount} to ${toChar.name}. ${note || ''}`
          : `${fromChar.name} gave ${toChar.name} $${amount} as a gift. ${note || ''}`;

      await base44.asServiceRole.entities.Memory.create({
        character_id: to_character_id,
        title: `${fromChar.name} ${isLoan ? 'lent' : isRepayment ? 'repaid' : 'gave'} money`,
        description: memoryText,
        emotional_impact: isLoan ? 'grateful but aware of the obligation to repay' : isRepayment ? 'relieved and respected' : 'touched and grateful',
        lesson_learned: isLoan ? 'Some people show up when you need them most.' : isRepayment ? 'They kept their word.' : 'Generosity means something.',
        timestamp: now,
      }).catch(() => {});

      // Also create a memory for the sender so they remember the debt/gift
      await base44.asServiceRole.entities.Memory.create({
        character_id: from_id,
        title: isLoan ? `Lent $${amount} to ${toChar.name}` : isRepayment ? `Repaid $${amount} to ${toChar.name}` : `Gave $${amount} to ${toChar.name}`,
        description: memoryText,
        emotional_impact: isLoan ? 'hoping to be repaid' : isRepayment ? 'fulfilled' : 'generous',
        lesson_learned: isLoan ? 'I helped them out — they owe me.' : null,
        timestamp: now,
      }).catch(() => {});
    }
  }

  return Response.json({ success: true, amount, transfer_type, to: toChar.name, from: from_type === 'user' ? user.full_name : from_id });
});