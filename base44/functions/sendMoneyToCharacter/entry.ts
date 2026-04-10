import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, conversationId, amount } = await req.json();
    if (!characterId || !amount || amount <= 0) {
      return Response.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // Load user settings for balance
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
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

    // Post a message in the conversation so the character is aware
    if (conversationId) {
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'user',
        content: `I just sent you $${amount}. 💸`,
        timestamp: now,
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