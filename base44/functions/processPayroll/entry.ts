import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters for this user
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active'
    });

    const results = [];
    const today = new Date();

    for (const char of characters) {
      // Get or create financial record
      const financials = await base44.entities.CharacterFinancial.filter({
        character_id: char.id
      });

      let financial = financials[0];
      if (!financial) {
        financial = await base44.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
          current_balance: 6000,
          total_income: 0,
          total_expenses: 0,
          income_sources: []
        });
      }

      // Calculate bi-weekly pay
      let biweeklyPay = 0;
      const incomeSources = financial.income_sources || [];
      
      if (char.work_details?.job_title) {
        // Get hourly rate from occupation location
        if (char.occupation_location_id) {
          const locations = await base44.entities.LocationReference.filter({
            id: char.occupation_location_id
          });
          const location = locations[0];
          if (location && location.worker_pay_rates && location.worker_pay_rates[char.id]) {
            const hourlyRate = location.worker_pay_rates[char.id];
            biweeklyPay = hourlyRate * 80; // 40 hours/week * 2 weeks
          }
        }
      }

      // Check for annual salary in CharacterFinancial income_sources
      const annualSource = incomeSources.find(s => s.pay_type === 'annual');
      if (annualSource && annualSource.pay_amount) {
        biweeklyPay = Math.round((annualSource.pay_amount / 26) * 100) / 100;
      }

      if (biweeklyPay > 0) {
        const newBalance = financial.current_balance + biweeklyPay;
        const newTotalIncome = financial.total_income + biweeklyPay;

        // Update financial record
        await base44.entities.CharacterFinancial.update(financial.id, {
          current_balance: newBalance,
          total_income: newTotalIncome,
          income_sources: [
            ...incomeSources.filter(s => s.location_id),
            {
              location_id: char.occupation_location_id || 'primary_job',
              location_name: char.occupation_location_name || char.work_details?.workplace_type || 'Employment',
              pay_type: annualSource ? 'annual' : 'hourly',
              pay_amount: biweeklyPay,
              total_earned: (incomeSources.find(s => s.location_id === (char.occupation_location_id || 'primary_job'))?.total_earned || 0) + biweeklyPay,
              last_payment_date: today.toISOString()
            }
          ]
        });

        results.push({
          character_id: char.id,
          name: char.name,
          amount: biweeklyPay,
          new_balance: newBalance,
          status: 'success'
        });
      }
    }

    return Response.json({ success: true, payroll: results, processed: results.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});