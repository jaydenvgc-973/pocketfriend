import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, conversationId, amount, reason } = await req.json();
    if (!characterId || !amount || amount <= 0) {
      return Response.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // Load user settings for balance — owner_email is the source of truth, NOT created_by
    const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email });
    const settings = settingsList[0];
    if (!settings) return Response.json({ error: 'User settings not found' }, { status: 404 });
    if ((settings.user_balance ?? 0) < amount) {
      return Response.json({ error: 'Insufficient funds' }, { status: 400 });
    }

    // Load character
    const chars = await base44.entities.Character.filter({ id: characterId });
    const character = chars[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const now = new Date().toISOString();

    // Deduct from user balance
    const newUserBalance = (settings.user_balance ?? 0) - amount;
    await base44.entities.UserSettings.update(settings.id, { user_balance: newUserBalance });

    // Update character financial record
    const finRecords = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
    const finRecord = finRecords[0];
    if (finRecord) {
      const newCharBalance = (finRecord.current_balance ?? 0) + amount;
      await base44.entities.CharacterFinancial.update(finRecord.id, {
        current_balance: newCharBalance,
        total_income: (finRecord.total_income ?? 0) + amount,
      });
    }

    // Log financial transactions
    await base44.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: character.name,
      sender_id: user.email,
      sender_type: 'user',
      sender_name: user.full_name || 'You',
      receiver_id: characterId,
      receiver_type: 'character',
      receiver_name: character.name,
      amount,
      direction: 'income',
      transaction_type: 'gift',
      description: `${user.full_name || 'User'} sent $${amount} to ${character.name}`,
      balance_after: finRecord ? (finRecord.current_balance ?? 0) + amount : amount,
      timestamp: now,
    });

    // Post a visible money-transfer card in the conversation.
    // FIX: previously this created a plain text message — no card UI appeared in chat.
    // Now we add a money_transfer field so MessageBubble can render it as a card,
    // plus keep a text content fallback for the conversation preview.
    if (conversationId) {
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'user',
        content: `💸 Sent $${amount.toLocaleString()} to ${character.name}`,
        timestamp: now,
        money_transfer: {
          amount,
          direction: 'sent',
          recipient_name: character.name,
          recipient_id: characterId,
          reason: reason || null,
          timestamp: now,
        },
      });
    }

    return Response.json({
      success: true,
      newUserBalance,
      amountSent: amount,
      characterName: character.name,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});