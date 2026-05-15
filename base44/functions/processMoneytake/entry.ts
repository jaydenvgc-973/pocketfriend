import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, amount, title } = await req.json();

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

    // Check balance from CharacterFinancial (canonical source of truth)
    const finRecords = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId }, null, 1);
    const finRecord = finRecords[0];
    const charBalance = finRecord ? (finRecord.current_balance ?? 0) : (character.current_balance || 0);
    if (charBalance < amount) {
      return Response.json({
        success: false,
        error: 'Insufficient balance',
        available: charBalance,
      }, { status: 400 });
    }

    // Evaluate discovery risk
    const discoveries = evaluateDiscoveryRisk(character, amount, title);

    // EXECUTE HIDDEN WITHDRAWAL
    try {
      // Create hidden transaction (appears as statement entry)
      await base44.entities.FinancialTransaction.create({
        character_id: characterId,
        character_name: character.name,
        sender_id: characterId,
        sender_type: 'character',
        sender_name: character.name,
        receiver_id: user.id || user.email,
        receiver_type: 'user',
        receiver_name: user.full_name,
        amount,
        direction: 'expense', // From character's perspective
        transaction_type: 'other', // Obfuscate the true nature
        description: title, // This is what appears on their statement
        timestamp: new Date().toISOString(),
        owner_email: user.email,
      });

      // Update CharacterFinancial (canonical balance source)
      const newCharBalance = charBalance - amount;
      if (finRecord) {
        await base44.asServiceRole.entities.CharacterFinancial.update(finRecord.id, {
          current_balance: newCharBalance,
          total_expenses: (finRecord.total_expenses ?? 0) + amount,
        });
      }

      // Update user balance
      const userSettings = await base44.entities.UserSettings.filter(
        { owner_email: user.email },
        null,
        1
      );
      if (userSettings && userSettings[0]) {
        const newBalance = (userSettings[0].user_balance || 6000) + amount;
        await base44.entities.UserSettings.update(userSettings[0].id, {
          user_balance: newBalance,
        });
      }

      // IF HIGH SUSPICION: Create discovery event memory + potential autonomous investigation
      if (discoveries.suspicionLevel === 'high') {
        try {
          await base44.entities.CharacterMemory.create({
            character_id: characterId,
            memory_type: 'event',
            memory_text: `I noticed a suspicious transaction: "${title}" for $${amount}. ${discoveries.suspicionReason}. I'm confused/worried about this.`,
            memory_summary: `Suspicious transaction detected: ${title}`,
            importance_score: 8,
            confidence_score: 0.9,
            permanence: 'long_term',
            owner_email: user.email,
          });

          // Flag for autonomous investigation (can trigger questioning, confrontation, etc.)
          // This would tie into autonomous character behavior system
          await base44.entities.CharacterAutonomyEvent.create({
            character_id: characterId,
            event_type: 'financial_investigation',
            status: 'pending',
            trigger_data: {
              amount,
              title,
              suspicionLevel: discoveries.suspicionLevel,
            },
            owner_email: user.email,
          }).catch(() => {}); // Soft fail if entity doesn't exist
        } catch (err) {
          console.warn('[discovery memory creation]', err.message);
        }
      } else if (discoveries.suspicionLevel === 'medium') {
        try {
          await base44.entities.CharacterMemory.create({
            character_id: characterId,
            memory_type: 'event',
            memory_text: `I saw a charge on my account: "${title}" for $${amount}. Hmm, not sure about that one. ${discoveries.suspicionReason}`,
            memory_summary: `Unclear charge: ${title}`,
            importance_score: 4,
            confidence_score: 0.6,
            permanence: 'long_term',
            owner_email: user.email,
          });
        } catch (err) {
          console.warn('[medium suspicion memory]', err.message);
        }
      }

      return Response.json({
        success: true,
        message: `Withdrew $${amount.toFixed(2)} from ${character.name}.`,
        outcome: `Character sees "${title}" on their statement.`,
        suspicionLevel: discoveries.suspicionLevel,
        suspicionReason: discoveries.suspicionReason,
        discoveryRisk: discoveries.discoveryProbability,
        note:
          discoveries.suspicionLevel === 'high'
            ? 'High risk of discovery — character may investigate or confront you.'
            : discoveries.suspicionLevel === 'medium'
              ? 'Moderate risk — character may question this transaction casually.'
              : 'Low risk — character unlikely to notice.',
      });
    } catch (err) {
      return Response.json({
        error: 'Withdrawal failed',
        details: err.message,
      }, { status: 500 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function evaluateDiscoveryRisk(character, amount, title) {
  let suspicionScore = 0; // 0-100

  // ── AMOUNT REALISM ──
  // Normal transactions are small ($5-100)
  if (amount > 500) {
    suspicionScore += 30; // Large amount is unusual
  } else if (amount > 200) {
    suspicionScore += 20;
  } else if (amount > 100) {
    suspicionScore += 10;
  }

  // ── TITLE REALISM ──
  const normalTitles = [
    'coffee',
    'uber',
    'mcdonalds',
    'grocery',
    'gas',
    'atm',
    'netflix',
    'spotify',
    'amazon',
    'starbucks',
    'restaurant',
    'hotel',
    'airline',
    'taxi',
  ];

  const titleLower = title.toLowerCase();
  const titleLooksReal = normalTitles.some(t => titleLower.includes(t));

  if (!titleLooksReal) {
    suspicionScore += 15; // Odd merchant name
  }

  // ── AMOUNT vs TITLE ──
  // $1000 at McDonald's is absurd
  if (titleLower.includes('mcdonalds') && amount > 100) {
    suspicionScore += 25; // Clearly fake
  } else if ((titleLower.includes('coffee') || titleLower.includes('starbucks')) && amount > 50) {
    suspicionScore += 20;
  } else if (titleLower.includes('uber') && amount > 200) {
    suspicionScore += 15;
  }

  // ── CHARACTER PERSONALITY ──
  if (character.trait_paranoid) suspicionScore += 15;
  if (character.trait_anxious) suspicionScore += 10;
  if (character.trait_cynical) suspicionScore += 8;
  if (character.trait_trusting) suspicionScore -= 15;
  if (character.trait_oblivious) suspicionScore -= 10;

  // ── FINANCIAL LITERACY ──
  // Characters with financial traits are more likely to scrutinize
  if (character.occupation === 'accountant' || character.occupation === 'financial analyst') {
    suspicionScore += 20;
  }

  // ── STRESS/MENTAL STATE ──
  if (character.mental_value && character.mental_value < 40) {
    suspicionScore += 10; // Stressed characters are more vigilant
  }

  // ── NORMALIZE ──
  suspicionScore = Math.max(0, Math.min(100, suspicionScore));

  // ── DECISION ──
  let suspicionLevel = 'low';
  let discoveryProbability = 0.1;
  let suspicionReason = 'Looks like a normal transaction.';

  if (suspicionScore >= 70) {
    suspicionLevel = 'high';
    discoveryProbability = 0.6;
    suspicionReason = `This doesn't add up — the amount or merchant seem off.`;
  } else if (suspicionScore >= 40) {
    suspicionLevel = 'medium';
    discoveryProbability = 0.3;
    suspicionReason = 'I barely noticed, but something felt slightly off.';
  }

  return {
    suspicionLevel,
    suspicionReason,
    discoveryProbability,
  };
}