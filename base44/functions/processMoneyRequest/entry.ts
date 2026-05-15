import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, amount, title, note, urgency } = await req.json();

    // Validate inputs
    if (!characterId || !amount || !title) {
      return Response.json({
        error: 'Missing required fields: characterId, amount, title',
      }, { status: 400 });
    }

    if (amount <= 0) {
      return Response.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    // Fetch character — user-scoped first (RLS), fall back to service role for NPCs
    let charArray = await base44.entities.Character.filter({ id: characterId }, null, 1);
    if (!charArray?.length) {
      charArray = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    }

    if (!charArray || charArray.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const character = charArray[0];

    // Fetch relationship data
    const relationshipArray = await base44.entities.CharacterRelationship.filter(
      { source_character_id: characterId },
      null,
      1
    );
    const relationship = relationshipArray?.[0] || {};

    // Fetch recent memories to assess prior patterns
    const recentMemoriesArray = await base44.entities.CharacterMemory.filter(
      { character_id: characterId },
      '-created_date',
      20
    );

    // DECISION ENGINE
    const decision = evaluateRequestDecision(
      character,
      relationship,
      recentMemoriesArray,
      amount,
      title,
      urgency,
      note
    );

    // PROCESS DECISION
    let transactionCompleted = false;
    let finalAmount = amount;

    if (decision.outcome === 'approved') {
      // Execute transfer
      try {
        const transaction = await base44.entities.FinancialTransaction.create({
          character_id: characterId,
          character_name: character.name,
          sender_id: characterId,
          sender_type: 'character',
          sender_name: character.name,
          receiver_id: user.id || user.email, // Use email as fallback ID
          receiver_type: 'user',
          receiver_name: user.full_name,
          amount: finalAmount,
          direction: 'income', // From character's perspective, it's an expense; from user's, it's income
          transaction_type: 'gift', // or 'loan' depending on context
          description: `Request: ${title}`,
          timestamp: new Date().toISOString(),
          owner_email: user.email,
        });

        // Update user balance
        const userSettings = await base44.entities.UserSettings.filter(
          { owner_email: user.email },
          null,
          1
        );
        if (userSettings && userSettings[0]) {
          const newBalance = (userSettings[0].user_balance || 6000) + finalAmount;
          await base44.entities.UserSettings.update(userSettings[0].id, {
            user_balance: newBalance,
          });
        }

        // Deduct from CharacterFinancial (canonical balance source)
        const finRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId }, null, 1);
        const finRec = finRecs[0];
        if (finRec) {
          await base44.asServiceRole.entities.CharacterFinancial.update(finRec.id, {
            current_balance: (finRec.current_balance ?? 0) - finalAmount,
            total_expenses: (finRec.total_expenses ?? 0) + finalAmount,
          });
        }

        transactionCompleted = true;
      } catch (err) {
        return Response.json({
          error: 'Transaction failed',
          details: err.message,
        }, { status: 500 });
      }
    } else if (decision.outcome === 'counter_offer') {
      finalAmount = decision.counterAmount;
      // Execute counter-offer transfer
      try {
        await base44.entities.FinancialTransaction.create({
          character_id: characterId,
          character_name: character.name,
          sender_id: characterId,
          sender_type: 'character',
          sender_name: character.name,
          receiver_id: user.id || user.email,
          receiver_type: 'user',
          receiver_name: user.full_name,
          amount: finalAmount,
          direction: 'income',
          transaction_type: 'gift',
          description: `Counter-offer: ${title}`,
          timestamp: new Date().toISOString(),
          owner_email: user.email,
        });

        const userSettings = await base44.entities.UserSettings.filter(
          { owner_email: user.email },
          null,
          1
        );
        if (userSettings && userSettings[0]) {
          const newBalance = (userSettings[0].user_balance || 6000) + finalAmount;
          await base44.entities.UserSettings.update(userSettings[0].id, {
            user_balance: newBalance,
          });
        }

        // Deduct from CharacterFinancial (canonical balance source)
        const finRecs2 = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId }, null, 1);
        const finRec2 = finRecs2[0];
        if (finRec2) {
          await base44.asServiceRole.entities.CharacterFinancial.update(finRec2.id, {
            current_balance: (finRec2.current_balance ?? 0) - finalAmount,
            total_expenses: (finRec2.total_expenses ?? 0) + finalAmount,
          });
        }

        transactionCompleted = true;
      } catch (err) {
        return Response.json({
          error: 'Counter-offer transaction failed',
          details: err.message,
        }, { status: 500 });
      }
    }

    // CREATE MEMORY
    if (transactionCompleted || decision.outcome === 'approved' || decision.outcome === 'counter_offer') {
      try {
        await base44.entities.CharacterMemory.create({
          character_id: characterId,
          memory_type: 'event',
          memory_text: `${user.full_name} asked for $${finalAmount} for ${title}. I ${decision.outcome === 'approved' ? 'approved' : decision.outcome === 'counter_offer' ? `counter-offered $${finalAmount}` : 'denied'} ${note ? `(note: ${note})` : ''}.`,
          memory_summary: `${user.full_name} requested $${finalAmount} - ${decision.outcome}`,
          importance_score: 6,
          confidence_score: 1,
          permanence: 'long_term',
          owner_email: user.email,
        });
      } catch (err) {
        console.warn('[memory creation failed]', err.message);
      }
    }

    return Response.json({
      success: transactionCompleted || decision.outcome === 'denied' || decision.outcome === 'delayed',
      outcome: decision.outcome,
      message: decision.message,
      counterAmount: decision.counterAmount || null,
      finalAmount: transactionCompleted ? finalAmount : null,
      characterReminder: decision.characterReminder,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function evaluateRequestDecision(character, relationship, memories, amount, title, urgency, note) {
  // WEIGHTED DECISION ENGINE
  // Based on: relationship, memory patterns, financial state, personality

  let approvalScore = 50; // 0-100 baseline

  // ── RELATIONSHIP FACTORS ──
  const friendshipLevel = relationship.friendship_level ?? 50;
  const trustLevel = relationship.trust_level ?? 50;
  const respectLevel = relationship.respect_level ?? 50;

  approvalScore += (friendshipLevel - 50) * 0.2; // ±10 points
  approvalScore += (trustLevel - 50) * 0.25; // ±12.5 points
  approvalScore += (respectLevel - 50) * 0.15; // ±7.5 points

  // ── FINANCIAL STATE ──
  const charBalance = character.current_balance || 0;
  if (charBalance < amount * 1.5) {
    approvalScore -= 15; // Struggling to afford
  }

  // ── MEMORY PATTERNS ──
  const priorRequests = memories.filter(m =>
    m.memory_text?.toLowerCase().includes('asked for') ||
    m.memory_text?.toLowerCase().includes('request')
  ).length;

  if (priorRequests > 3) {
    approvalScore -= 10; // Pattern of requests
  }

  if (priorRequests > 0) {
    // Check repayment history
    const repaidMemories = memories.filter(m =>
      m.memory_text?.toLowerCase().includes('paid back') ||
      m.memory_text?.toLowerCase().includes('repaid')
    ).length;

    if (repaidMemories === 0 && priorRequests > 0) {
      approvalScore -= 20; // Never repaid before
    } else if (repaidMemories > 0) {
      approvalScore += 10; // Good repayment history
    }
  }

  // ── PERSONALITY FACTORS ──
  if (character.trait_generous) approvalScore += 15;
  if (character.trait_compassionate) approvalScore += 10;
  if (character.trait_loyal) approvalScore += 8;
  if (character.trait_self_absorbed) approvalScore -= 15;
  if (character.trait_cynical) approvalScore -= 10;

  // ── URGENCY ──
  if (urgency === 'urgent') approvalScore += 5;
  if (urgency === 'low') approvalScore -= 3;

  // ── AMOUNT ──
  const percentOfBalance = (amount / Math.max(charBalance, 1)) * 100;
  if (percentOfBalance > 50) {
    approvalScore -= 20; // Large amount relative to their balance
  } else if (percentOfBalance > 25) {
    approvalScore -= 10;
  }

  // ── NORMALIZE ──
  approvalScore = Math.max(0, Math.min(100, approvalScore));

  // ── OUTCOME DECISION ──
  if (approvalScore >= 70) {
    return {
      outcome: 'approved',
      message: `${character.name} said yes! They're giving you $${amount.toFixed(2)}.`,
      characterReminder: `I wanted to help ${note ? `because ${note}` : 'you out'}.`,
    };
  } else if (approvalScore >= 50) {
    // Counter-offer: 60-75% of requested amount
    const counterAmount = Math.round((amount * 0.6) * 100) / 100;
    return {
      outcome: 'counter_offer',
      message: `${character.name} offered $${counterAmount.toFixed(2)} instead. Less than requested, but something.`,
      counterAmount,
      characterReminder: `I couldn't spare the full amount, but I could help with $${counterAmount.toFixed(2)}.`,
    };
  } else if (approvalScore >= 30) {
    return {
      outcome: 'delayed',
      message: `${character.name} said "maybe later." They're not sure right now.`,
      characterReminder: `Ask me again another time. I'm tight on cash right now.`,
    };
  } else {
    return {
      outcome: 'denied',
      message: `${character.name} said no. They can't help with this right now.`,
      characterReminder: `I couldn't help you out this time. Maybe another time.`,
    };
  }
}