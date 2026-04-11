import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * auditBalanceResets
 * 
 * Detects characters whose balances have been reset to $6,000 without corresponding expenses.
 * Checks for:
 * 1. Characters with balance = 6000 but total_expenses > 0 (indicates a reset)
 * 2. Mismatches between balance and calculated balance from transactions
 * 3. Characters where CharacterFinancial was recreated (missing income history)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all characters
    const characters = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const issues = [];
    const suspicious = [];

    for (const char of characters) {
      // Get financial record
      const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({
        character_id: char.id,
      });

      if (!financials[0]) {
        issues.push({
          character_id: char.id,
          character_name: char.name,
          issue: 'No CharacterFinancial record found',
          severity: 'high',
        });
        continue;
      }

      const financial = financials[0];
      const balance = financial.current_balance || 0;
      const totalExpenses = financial.total_expenses || 0;
      const totalIncome = financial.total_income || 0;

      // Issue 1: Balance at 6000 but expenses exist (reset indicator)
      if (balance === 6000 && totalExpenses > 0) {
        issues.push({
          character_id: char.id,
          character_name: char.name,
          issue: 'Balance reset to $6,000 despite expenses',
          balance,
          total_expenses: totalExpenses,
          total_income: totalIncome,
          calculated_balance: 6000 + totalIncome - totalExpenses,
          created_date: financial.created_date,
          last_updated: financial.last_updated,
          severity: 'critical',
        });
      }

      // Issue 2: Check transaction history vs recorded balance
      const transactions = await base44.asServiceRole.entities.FinancialTransaction.filter(
        { character_id: char.id },
        '-timestamp',
        100
      );

      if (transactions.length > 0) {
        // Calculate expected balance from transactions
        let calculatedBalance = 6000;
        for (const tx of transactions) {
          if (tx.direction === 'income') {
            calculatedBalance += tx.amount || 0;
          } else if (tx.direction === 'expense') {
            calculatedBalance -= tx.amount || 0;
          }
        }

        const discrepancy = Math.abs(balance - calculatedBalance);
        if (discrepancy > 1) {
          suspicious.push({
            character_id: char.id,
            character_name: char.name,
            current_balance: balance,
            calculated_from_transactions: calculatedBalance,
            discrepancy,
            transaction_count: transactions.length,
            last_transaction: transactions[0]?.timestamp,
            severity: 'high',
          });
        }
      }

      // Issue 3: Check for missing income despite jobs
      if ((char.occupation_location_id || char.additional_occupation_locations?.length > 0) && totalIncome === 0) {
        suspicious.push({
          character_id: char.id,
          character_name: char.name,
          issue: 'Character has job(s) but $0 total income',
          has_primary_job: !!char.occupation_location_id,
          has_secondary_jobs: (char.additional_occupation_locations?.length || 0) > 0,
          balance,
          total_income: totalIncome,
          severity: 'medium',
        });
      }
    }

    // Also check user settings
    const userSettingsList = await base44.asServiceRole.entities.UserSettings.list();
    const userIssues = [];
    for (const settings of userSettingsList) {
      const balance = settings.user_balance || 0;
      if (balance === 6000) {
        userIssues.push({
          user_email: settings.created_by,
          issue: 'User balance reset to $6,000',
          balance,
          created_date: settings.created_date,
          last_updated: settings.updated_date,
        });
      }
    }

    return Response.json({
      success: true,
      total_characters_checked: characters.length,
      critical_issues: issues.filter(i => i.severity === 'critical').length,
      all_issues: issues.length,
      suspicious: suspicious.length,
      user_issues: userIssues.length,
      details: {
        issues,
        suspicious,
        user_issues: userIssues,
      },
    });
  } catch (error) {
    console.error('[auditBalanceResets]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});