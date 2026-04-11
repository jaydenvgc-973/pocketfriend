/**
 * processDebtEscalation
 *
 * Handles the full debt lifecycle:
 * - Detects characters with negative balances
 * - Escalates to collection → court → jail at $3000 debt threshold
 * - Releases jailed characters after 7 days, clears debt, resets balance to $6000
 * - Logs all events to Memory and updates current_situation
 *
 * Called by scheduled automation (daily).
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const nowISO = now.toISOString();

  const characters = await base44.asServiceRole.entities.Character.filter({
    created_by: user.email,
    status: 'active',
  });

  const results = [];

  for (const char of characters) {
    // ── JAIL RELEASE CHECK ──────────────────────────────────────────────────
    if (char.is_jailed && char.jail_release_date) {
      const releaseDate = new Date(char.jail_release_date);
      if (now >= releaseDate) {
        // Release: clear debt, reset balance to $6000
        const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
        const financial = financials[0];

        if (financial) {
          await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
            current_balance: 6000,
            total_expenses: financial.total_expenses || 0,
          });

          // Log reset transaction
          await base44.asServiceRole.entities.FinancialTransaction.create({
            character_id: char.id,
            character_name: char.name,
            sender_id: 'system',
            sender_type: 'system',
            sender_name: 'System',
            receiver_id: char.id,
            receiver_type: 'character',
            receiver_name: char.name,
            amount: 6000,
            direction: 'income',
            transaction_type: 'other',
            description: 'Balance reset after jail release — all debts cleared',
            balance_after: 6000,
            timestamp: nowISO,
          });
        }

        // Unlock character
        await base44.asServiceRole.entities.Character.update(char.id, {
          is_jailed: false,
          jail_release_date: null,
          jailed_at: null,
          current_situation: `${char.name} was recently released from jail. Their debts have been cleared and they are starting fresh with $6,000. The experience left a mark, but they are free.`,
          emotional_state: 'reflective',
        });

        // Memory: jail release
        await base44.asServiceRole.entities.Memory.create({
          character_id: char.id,
          title: 'Released from jail',
          description: `After serving time, ${char.name} was released from jail. All debts were cleared as part of the process. They now have $6,000 to restart their life.`,
          emotional_impact: 'humbling and sobering — a fresh start, but the memory lingers',
          lesson_learned: 'Financial pressure can spiral into serious consequences. Support systems and responsible decisions matter.',
          timestamp: nowISO,
        });

        results.push({ character: char.name, action: 'released_from_jail' });
        continue;
      }

      // Still in jail — skip further processing
      results.push({ character: char.name, action: 'still_jailed', releaseDate: char.jail_release_date });
      continue;
    }

    // ── DEBT DETECTION ──────────────────────────────────────────────────────
    const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
    const financial = financials[0];
    if (!financial || financial.current_balance >= 0) continue;

    const debt = Math.abs(financial.current_balance);

    // Collection stage: any negative balance
    if (debt > 0 && debt < 3000) {
      // Apply mental/comfort pressure
      const newMental = Math.max(0, (char.mental_value || 70) - 5);
      const newComfort = Math.max(0, (char.comfort_value || 70) - 3);
      await base44.asServiceRole.entities.Character.update(char.id, {
        mental_value: newMental,
        comfort_value: newComfort,
        current_situation: `${char.name} is dealing with debt of $${debt.toFixed(2)}. They are under financial pressure and receiving collection notices.`,
        emotional_state: 'stressed',
      });

      // Log collection notice transaction
      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: char.id,
        character_name: char.name,
        sender_id: 'system',
        sender_type: 'system',
        sender_name: 'Debt Collection',
        receiver_id: char.id,
        receiver_type: 'character',
        receiver_name: char.name,
        amount: 0,
        direction: 'expense',
        transaction_type: 'other',
        description: `Collection Notice — Outstanding balance: -$${debt.toFixed(2)}`,
        balance_after: financial.current_balance,
        timestamp: nowISO,
      });

      results.push({ character: char.name, action: 'collection_notice', debt });
    }

    // Court + Jail stage: debt >= $3000
    if (debt >= 3000 && !char.is_jailed) {
      const jailRelease = new Date(now);
      jailRelease.setDate(jailRelease.getDate() + 7);

      await base44.asServiceRole.entities.Character.update(char.id, {
        is_jailed: true,
        jailed_at: nowISO,
        jail_release_date: jailRelease.toISOString(),
        jail_sentence_days: 7,
        current_situation: `${char.name} has been jailed due to unpaid debts totaling $${debt.toFixed(2)}. They are currently serving a 7-day sentence and cannot be contacted, travel, or take any actions.`,
        emotional_state: 'anxious',
        mental_value: Math.max(0, (char.mental_value || 70) - 20),
      });

      // Court summons memory
      await base44.asServiceRole.entities.Memory.create({
        character_id: char.id,
        title: 'Court summons for unpaid debt',
        description: `${char.name} was taken to court due to debt escalating to $${debt.toFixed(2)}. After the hearing, they were sentenced to 7 days in jail.`,
        emotional_impact: 'devastating and humiliating — a low point in their life',
        lesson_learned: 'Ignoring financial obligations has serious legal consequences.',
        timestamp: nowISO,
      });

      // Log court/jail transaction
      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: char.id,
        character_name: char.name,
        sender_id: 'system',
        sender_type: 'system',
        sender_name: 'Court System',
        receiver_id: char.id,
        receiver_type: 'character',
        receiver_name: char.name,
        amount: 0,
        direction: 'expense',
        transaction_type: 'other',
        description: `Court Summons → Jail Sentence (7 days) — Debt: -$${debt.toFixed(2)}`,
        balance_after: financial.current_balance,
        timestamp: nowISO,
      });

      results.push({ character: char.name, action: 'jailed', debt, releaseDate: jailRelease.toISOString() });
    }
  }

  return Response.json({ processed: results.length, results });
});