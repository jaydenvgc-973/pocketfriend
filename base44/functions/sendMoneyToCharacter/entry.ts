import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, conversationId, amount, reason, direction } = await req.json();
    const isAnonymous = direction === 'anonymous';
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
    // For anonymous sends: use the statement title as description; hide sender identity
    await base44.entities.FinancialTransaction.create({
      character_id: characterId,
      character_name: character.name,
      sender_id: isAnonymous ? 'anonymous' : user.email,
      sender_type: isAnonymous ? 'system' : 'user',
      sender_name: isAnonymous ? null : (user.full_name || 'You'),
      receiver_id: characterId,
      receiver_type: 'character',
      receiver_name: character.name,
      amount,
      direction: 'income',
      transaction_type: 'gift',
      description: isAnonymous ? reason : `${user.full_name || 'User'} sent $${amount} to ${character.name}`,
      balance_after: finRecord ? (finRecord.current_balance ?? 0) + amount : amount,
      timestamp: now,
    });

    // Anonymous sends: create suspicion memory in character if amount is large/unusual
    if (isAnonymous) {
      const suspicionScore = amount > 1000 ? 'high' : amount > 200 ? 'medium' : 'low';
      const memoryText = suspicionScore === 'high'
        ? `I received a large unexpected deposit: "${reason}" +$${amount}. I don't know where it came from and I'm concerned.`
        : suspicionScore === 'medium'
          ? `A payment appeared on my account: "${reason}" +$${amount}. Not sure what it's for.`
          : `I received "${reason}" +$${amount} — probably just a normal transaction.`;
      await base44.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'event',
        memory_text: memoryText,
        memory_summary: `Received ${reason}: +$${amount}`,
        importance_score: suspicionScore === 'high' ? 7 : suspicionScore === 'medium' ? 4 : 2,
        confidence_score: 0.8,
        permanence: 'long_term',
        owner_email: user.email,
      }).catch(() => {});
    }

    // Post a visible money-transfer card in the conversation (only for direct sends).
    // Anonymous sends do not create a visible card for the user — it's a hidden action.
    if (conversationId && !isAnonymous) {
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

      // ── CHARACTER RESPONSE TO MONEY RECEIVED ──────────────────────────────
      // The character must react to receiving money — not silently accept it.
      // Build a rich prompt so the response reflects reason, relationship, amount, personality.
      try {
        const finRecords2 = await base44.entities.CharacterFinancial.filter({ character_id: characterId }).catch(() => []);
        const newBalance = (finRecords2[0]?.current_balance ?? amount);
        const reasonContext = reason
          ? `The sender included this note/reason: "${reason}".`
          : `No reason was given for the payment.`;
        const amountContext = amount >= 1000 ? 'a significant amount' : amount >= 200 ? 'a decent amount' : 'a small amount';
        const personalityCtx = [
          character.personality_summary ? `Personality: ${character.personality_summary}.` : '',
          character.emotional_state ? `Current emotional state: ${character.emotional_state}.` : '',
          character.friendship_level > 75 ? 'You are close to this person.' : character.friendship_level > 40 ? 'You have a normal relationship with this person.' : 'You are not especially close.',
        ].filter(Boolean).join(' ');

        const replyPrompt = `You are ${character.name}. ${personalityCtx}

The person you are talking to just sent you $${amount.toLocaleString()} (${amountContext}).
${reasonContext}

Write a short, natural, in-character text message response to receiving this money. Rules:
- React authentically based on your personality and the reason provided.
- If no reason was given, ask what it's for or thank them while showing mild curiosity.
- Do NOT say "as an AI" or break character.
- If the amount is large, show appropriate reaction (surprise, appreciation, concern, etc.).
- Keep it 1-3 sentences. Real, casual, texting style.
- Do NOT start with your own name.
- Return ONLY the reply text, no labels or formatting.`;

        const replyRes = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: replyPrompt });
        const replyText = (typeof replyRes === 'string' ? replyRes.trim() : '') || `Thanks for the $${amount.toLocaleString()}!`;

        await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: replyText,
          emotional_state: character.emotional_state || 'calm',
          is_read: false,
          timestamp: new Date().toISOString(),
          // Event context stored so memory extraction can pick it up
          source_message_id: null,
          memory_eligible: true,
          relationship_eligible: true,
          recovery_signal: false,
        });

        // Also save a memory about receiving money if reason is meaningful
        if (reason && amount >= 100) {
          await base44.entities.CharacterMemory.create({
            character_id: characterId,
            memory_type: 'event',
            memory_text: `Received $${amount} from the user. Reason: "${reason}". This was meaningful enough to remember.`,
            memory_summary: `Received $${amount}: ${reason}`,
            importance_score: amount >= 500 ? 7 : 5,
            confidence_score: 0.95,
            permanence: 'long_term',
            owner_email: user.email,
          }).catch(() => {});
        }
      } catch (replyErr) {
        // Non-fatal — money transaction succeeded, reply is best-effort
        console.warn('[sendMoneyToCharacter] Character reply generation failed:', replyErr?.message);
      }
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