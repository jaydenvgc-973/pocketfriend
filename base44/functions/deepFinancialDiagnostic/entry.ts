import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * deepFinancialDiagnostic
 * 
 * Comprehensive audit of all financial data to find reset patterns:
 * 1. Transaction history anomalies (sudden balance drops, duplicate charges)
 * 2. CharacterFinancial vs transaction mismatches
 * 3. Income tracking gaps (income_sources empty but transactions exist)
 * 4. Characters missing financial records entirely
 * 5. Expense tracking discrepancies
 * 6. Double-charging patterns (same expense multiple times)
 * 7. Orphaned transactions (no matching CharacterFinancial)
 * 8. UserSettings balance anomalies
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const characters = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const findings = {
      missing_financial_records: [],
      income_tracking_gaps: [],
      double_charges: [],
      balance_discrepancies: [],
      transaction_anomalies: [],
      expense_tracking_gaps: [],
      orphaned_transactions: [],
      reset_patterns: [],
    };

    // === ISSUE 1: Check for missing CharacterFinancial records ===
    for (const char of characters) {
      const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
        character_id: char.id,
      });

      if (!financials[0]) {
        const txCount = await base44.asServiceRole.entities.FinancialTransaction.filter(
          { character_id: char.id },
          null,
          1
        );

        findings.missing_financial_records.push({
          character_id: char.id,
          character_name: char.name,
          has_transactions: txCount.length > 0,
          transaction_count: txCount.length,
        });
      }
    }

    // === ISSUE 2: Check each character's financial health ===
    for (const char of characters) {
      try {
        const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
          character_id: char.id,
        });

        if (!financials[0]) continue;
        const financial = financials[0];

        // Get all transactions
        const allTxs = await base44.asServiceRole.entities.FinancialTransaction.filter(
          { character_id: char.id },
          '-timestamp',
          500
        );

        if (allTxs.length === 0) continue;

        const currentBalance = financial.current_balance || 0;
        const recordedIncome = financial.total_income || 0;
        const recordedExpenses = financial.total_expenses || 0;

        // === ISSUE 3: Income tracking gaps ===
        const incomeTransactions = allTxs.filter(t => t.direction === 'income');
        const actualTotalIncome = incomeTransactions.reduce((s, t) => s + (t.amount || 0), 0);

        if (actualTotalIncome > 0 && recordedIncome === 0) {
          findings.income_tracking_gaps.push({
            character_id: char.id,
            character_name: char.name,
            actual_income_from_txs: actualTotalIncome,
            recorded_income: recordedIncome,
            income_tx_count: incomeTransactions.length,
            issue: 'Income exists in transactions but not recorded in total_income',
          });
        }

        // === ISSUE 4: Check for double-charges (same expense type, same day) ===
        const expensesByTypeAndDay = {};
        const expenseTransactions = allTxs.filter(t => t.direction === 'expense');

        for (const tx of expenseTransactions) {
          const day = tx.timestamp?.substring(0, 10); // YYYY-MM-DD
          const key = `${tx.transaction_type}_${day}`;
          if (!expensesByTypeAndDay[key]) {
            expensesByTypeAndDay[key] = [];
          }
          expensesByTypeAndDay[key].push(tx);
        }

        for (const [key, txs] of Object.entries(expensesByTypeAndDay)) {
          // Some charges happen multiple times (e.g., 3 daily food = 3 per day is OK)
          // But recurring expenses shouldn't appear more than once per month for same type
          if (txs.length > 5 && key.includes('utilities')) {
            findings.double_charges.push({
              character_id: char.id,
              character_name: char.name,
              charge_key: key,
              count: txs.length,
              issue: 'Recurring expense charged multiple times in single day',
              sample_txs: txs.slice(0, 3).map(t => ({ amount: t.amount, timestamp: t.timestamp, description: t.description })),
            });
          }
        }

        // === ISSUE 5: Balance discrepancy vs transaction history ===
        let calculatedBalance = 6000;
        for (const tx of allTxs) {
          if (tx.direction === 'income') {
            calculatedBalance += tx.amount || 0;
          } else if (tx.direction === 'expense') {
            calculatedBalance -= tx.amount || 0;
          }
        }
        calculatedBalance = Math.max(0, calculatedBalance);

        if (Math.abs(currentBalance - calculatedBalance) > 1) {
          findings.balance_discrepancies.push({
            character_id: char.id,
            character_name: char.name,
            recorded_balance: currentBalance,
            calculated_balance: calculatedBalance,
            discrepancy: Math.abs(currentBalance - calculatedBalance),
            transactions: allTxs.length,
          });
        }

        // === ISSUE 6: Expense tracking gap ===
        const actualTotalExpenses = expenseTransactions.reduce((s, t) => s + (t.amount || 0), 0);
        if (actualTotalExpenses > 0 && recordedExpenses === 0) {
          findings.expense_tracking_gaps.push({
            character_id: char.id,
            character_name: char.name,
            actual_expenses_from_txs: actualTotalExpenses,
            recorded_expenses: recordedExpenses,
            expense_tx_count: expenseTransactions.length,
            issue: 'Expenses exist in transactions but not recorded in total_expenses',
          });
        }

        // === ISSUE 7: Check for reset patterns ===
        // Sort transactions by timestamp
        const sortedTxs = [...allTxs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        let runningBalance = 6000;
        for (const tx of sortedTxs) {
          const txAmount = tx.amount || 0;
          const expectedNewBalance = tx.direction === 'income'
            ? runningBalance + txAmount
            : Math.max(0, runningBalance - txAmount);

          // If transaction has balance_after recorded, check if it matches
          if (tx.balance_after !== undefined && Math.abs(tx.balance_after - expectedNewBalance) > 5) {
            findings.transaction_anomalies.push({
              character_id: char.id,
              character_name: char.name,
              transaction_id: tx.id,
              transaction_timestamp: tx.timestamp,
              transaction_type: tx.transaction_type,
              direction: tx.direction,
              amount: txAmount,
              recorded_balance_after: tx.balance_after,
              expected_balance_after: expectedNewBalance,
              issue: 'Transaction balance_after does not match expected balance',
            });
          }

          runningBalance = expectedNewBalance;
        }

        // Check for sudden balance drops without matching expenses
        for (let i = 1; i < sortedTxs.length; i++) {
          const prevTx = sortedTxs[i - 1];
          const currTx = sortedTxs[i];
          
          const prevBalance = prevTx.balance_after || 0;
          const currBalance = currTx.balance_after || 0;

          // Sudden drop > $1000 without matching expense
          if (currBalance < prevBalance - 1000 && currTx.direction !== 'expense') {
            findings.reset_patterns.push({
              character_id: char.id,
              character_name: char.name,
              timestamp: currTx.timestamp,
              balance_drop: prevBalance - currBalance,
              previous_balance: prevBalance,
              current_balance: currBalance,
              transaction_type: currTx.transaction_type,
              direction: currTx.direction,
              issue: 'Unexplained sudden balance drop',
            });
          }
        }

      } catch (err) {
        console.error(`Error processing ${char.name}:`, err.message);
      }
    }

    // === ISSUE 8: Check for orphaned transactions ===
    const allTransactions = await base44.asServiceRole.entities.FinancialTransaction.list('-timestamp', 500);
    const characterIds = new Set(characters.map(c => c.id));

    for (const tx of allTransactions) {
      if (!characterIds.has(tx.character_id)) {
        findings.orphaned_transactions.push({
          transaction_id: tx.id,
          character_id: tx.character_id,
          character_name: tx.character_name,
          amount: tx.amount,
          timestamp: tx.timestamp,
          issue: 'Transaction references non-existent or inactive character',
        });
      }
    }

    // === ISSUE 9: Check UserSettings balance patterns ===
    const userSettings = await base44.asServiceRole.entities.UserSettings.list();
    const userAnomalies = [];

    for (const settings of userSettings) {
      const balance = settings.user_balance || 0;
      const vgcRevenue = settings.vgc_mobile_revenue || 0;
      const createdDate = new Date(settings.created_date);
      const now = new Date();
      const daysSinceCreation = (now - createdDate) / (1000 * 60 * 60 * 24);

      // Flag suspicions
      if (balance === 6000 && vgcRevenue > 0) {
        userAnomalies.push({
          user_email: settings.created_by,
          issue: 'Balance is $6,000 (start value) but VGC revenue > 0 (should have been transferred or spent)',
          balance,
          vgc_revenue: vgcRevenue,
          days_old: Math.round(daysSinceCreation),
        });
      }

      if (balance === 6000 && daysSinceCreation > 14) {
        userAnomalies.push({
          user_email: settings.created_by,
          issue: 'Balance = $6,000 (start value) for 14+ day old account',
          balance,
          vgc_revenue: vgcRevenue,
          days_old: Math.round(daysSinceCreation),
        });
      }
    }

    return Response.json({
      success: true,
      characters_checked: characters.length,
      transactions_checked: allTransactions.length,
      summary: {
        missing_financial_records: findings.missing_financial_records.length,
        income_tracking_gaps: findings.income_tracking_gaps.length,
        double_charges: findings.double_charges.length,
        balance_discrepancies: findings.balance_discrepancies.length,
        transaction_anomalies: findings.transaction_anomalies.length,
        expense_tracking_gaps: findings.expense_tracking_gaps.length,
        orphaned_transactions: findings.orphaned_transactions.length,
        reset_patterns: findings.reset_patterns.length,
        user_balance_anomalies: userAnomalies.length,
      },
      details: {
        missing_financial_records: findings.missing_financial_records.slice(0, 10),
        income_tracking_gaps: findings.income_tracking_gaps.slice(0, 10),
        double_charges: findings.double_charges.slice(0, 10),
        balance_discrepancies: findings.balance_discrepancies.slice(0, 10),
        transaction_anomalies: findings.transaction_anomalies.slice(0, 10),
        expense_tracking_gaps: findings.expense_tracking_gaps.slice(0, 10),
        orphaned_transactions: findings.orphaned_transactions.slice(0, 10),
        reset_patterns: findings.reset_patterns.slice(0, 10),
        user_anomalies: userAnomalies.slice(0, 10),
      },
    });
  } catch (error) {
    console.error('[deepFinancialDiagnostic]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});